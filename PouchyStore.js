const PouchDB = require('./libs/PouchDB');
const checkInternet = require('./libs/checkInternet');

const DEBOUNCE_MS = 20;
const ID_META_DOC = 'meta';
const PREFIX_META_DB = 'meta_';

console.e = console.log;

/*

class options: create getter fo these:
- `this.name` string: give name to this store. throws exception if does not exist.
- `this.isUseRemote` boolean: give false if you do not want to sync with remote db. default to true.
- `this.optionsRemote` optional: give object as options for remote db constructor.
- `this.optionsLocal` optional

*/

class PouchyStore {
  constructor() {
    // set default options
    if (!('isUseRemote' in this)) {
      this.isUseRemote = true;
    }
    if (!('optionsLocal' in this)) {
      this.optionsLocal = {};
    }
    if (!('optionsRemote' in this)) {
      this.optionsRemote = {};
    }

    this.initializeProperties();
  }

  initializeProperties() {
    this.isInitialized = false;
    this.isRemoteInitialized = false;

    this.dataMeta = {
      // metadata of this store
      _id: ID_META_DOC,
      clientId: PouchDB.createId(),
      tsUpload: new Date(0).toJSON(),
    };

    this.lastDirtyAt = new Date(0).toJSON();

    this.dbLocal = null;
    this.dbMeta = null;
    this.dbRemote = null;
  }

  async initialize() {
    if (this.isInitialized) return;

    if (!this.name) {
      throw new Error('store must have this.name');
    }

    this.initializeLocal();
    this.initializeMeta();
    this.initUnuploadeds();

    this.isInitialized = true;
  }

  async initializeLocal() {
    this.dbLocal = new PouchDB(this.name, {
      auto_compaction: true,
      revs_limit: 2,
      ...this.optionsLocal,
    });

    this.watchLocal();
  }

  async initializeMeta() {
    this.dbMeta = new PouchDB(`${PREFIX_META_DB}${this.name}`, {
      auto_compaction: true,
      revs_limit: 2,
    });

    const dataMetaOld = await this.dbMeta.getFailSafe(ID_META_DOC);
    if (dataMetaOld) {
      this.dataMeta = dataMetaOld;
    } else {
      await this.persistMeta();
      this.dataMeta = await this.dbMeta.getFailSafe(ID_META_DOC);
    }

    this.watchMeta();
  }

  async initializeRemote() {
    if (this.isRemoteInitialized) return;
    if (!this.isUseRemote) return;

    if (!this.urlRemote) {
      throw new Error(`store's this.urlRemote should not be ${this.urlRemote}`);
    }

    this.dbRemote = new PouchDB(`${this.urlRemote}${this.name}`, {
      ...this.optionsRemote,
    });

    try {
      await checkInternet(this.urlRemote);
      await this.dbLocal.replicate.from(this.dbRemote, {
        batch_size: 1000,
        batches_limit: 2,
      });
    } catch (err) {
      console.log('error disini', err);
      console.e(err);
    }

    this.watchRemote();
    this.isRemoteInitialized = true;
  }

  async deinitialize() {
    await this.deinitializeRemote();

    this.unwatchLocal();
    this.unwatchMeta();

    await this.dbLocal.close();
    await this.dbMeta.close();

    this.initializeProperties();
  }

  async deinitializeRemote() {
    this.unwatchRemote();

    if (this.dbRemote) {
      await this.dbRemote.close();
    }

    this.isRemoteInitialized = false;
  }

  async persistMeta() {
    try {
      await this.dbMeta.put(this.dataMeta);
    } catch (err) {
      console.e(err);
    }
  }

  async initUnuploadeds() {
    this.lastDirtyAt = new Date(0).toJSON();

    const docs = await this.dbLocal.getDocs();
    for (const doc of docs) {
      const dirtyBySelf =
        (doc.dirtyBy || {}).clientId === this.dataMeta.clientId;
      if (!dirtyBySelf) continue;
      if (new Date(this.lastDirtyAt) < new Date(doc.dirtyAt)) {
        this.lastDirtyAt = doc.dirtyAt;
      }
    }
  }

  /* watch manager for local DB and remote DB */

  watchLocal() {
    this.unwatchLocal();

    this.handlerLocalChange = this.dbLocal.changes({
      since: 'now',
      live: true,
      include_docs: true,
    });

    this.handlerLocalChange.on('change', change => {
      const doc = change.doc;
      const dirtyBySelf =
        (doc.dirtyBy || {}).clientId === this.dataMeta.clientId;
      if (dirtyBySelf && new Date(this.lastDirtyAt) < new Date(doc.dirtyAt)) {
        this.lastDirtyAt = doc.dirtyAt;
      }
    });

    this.handlerLocalChange.on('error', err => {
      console.e(`${this.name}.local`, 'error', err);
    });
  }

  unwatchLocal() {
    if (this.handlerLocalChange) {
      this.handlerLocalChange.cancel();
    }
  }

  watchMeta() {
    this.unwatchMeta();

    this.handlerMetaChange = this.dbMeta.changes({
      since: 'now',
      live: true,
      include_docs: true,
    });

    this.handlerMetaChange.on('change', change => {
      const doc = change.doc;
      if (doc._id !== ID_META_DOC) return;
      this.dataMeta = doc;
    });

    this.handlerMetaChange.on('error', err => {
      console.e(`${PREFIX_META_DB}${this.name}.changes`, 'error', err);
    });
  }

  unwatchMeta() {
    if (this.handlerMetaChange) {
      this.handlerMetaChange.cancel();
    }
  }

  watchRemote() {
    this.unwatchRemote();

    this.handlerRemoteChange = this.dbLocal.replicate.from(this.dbRemote, {
      live: true,
      retry: true,
    });

    this.handlerRemoteChange.on('error', err => {
      console.e(`${this.name}.from`, 'error', err);
    });
  }

  unwatchRemote() {
    if (this.handlerRemoteChange) {
      this.handlerRemoteChange.cancel();
    }
  }

  /* data upload (from local DB to remote DB) */

  checkIsUploaded(doc) {
    const dirtyAt = doc.dirtyAt;
    const dirtyBySelf = (doc.dirtyBy || {}).clientId === this.dataMeta.clientId;

    if (!dirtyBySelf) {
      return true;
    }

    if (dirtyAt && new Date(dirtyAt) <= new Date(this.dataMeta.tsUpload)) {
      return true;
    }

    return false;
  }

  countUnuploadeds() {
    return new Date(this.dataMeta.tsUpload) < new Date(this.lastDirtyAt)
      ? 1
      : 0;
  }

  async upload() {
    await checkInternet(this.urlRemote);
    await this.dbLocal.replicate.to(this.dbRemote);

    this.dataMeta.tsUpload = new Date().toJSON();
    this.persistMeta();
  }

  /* manipulation of data */

  async addItem(payload, user = {}) {
    const id = this.dbLocal.createId();
    await this.addItemWithId(id, payload, user);
  }

  async addItemWithId(id, payload, user = {}) {
    const now = new Date().toJSON();
    const actionBy = this.createActionBy(user);
    await this.dbLocal.put({
      ...payload,
      _id: id,
      dirtyAt: now,
      dirtyBy: actionBy,
      createdAt: now,
      createdBy: actionBy,
      deletedAt: null,
    });
  }

  async editItem(id, payload, user = {}) {
    const now = new Date().toJSON();
    const actionBy = this.createActionBy(user);
    const doc = await this.dbLocal.getFailSafe(id);
    if (!doc) return;

    await this.dbLocal.put({
      ...doc,
      ...payload,
      dirtyAt: now,
      dirtyBy: actionBy,
      updatedAt: now,
      updatedBy: actionBy,
    });
  }

  async deleteItem(id, user = {}) {
    // TODO
    const now = new Date().toJSON();
    const actionBy = this.createActionBy(user);
    const doc = await this.dbLocal.getFailSafe(id);
    if (!doc) return;

    const payload = {
      ...doc,
      dirtyAt: now,
      dirtyBy: actionBy,
      deletedAt: now,
      deletedBy: actionBy,
    };

    const isRealDelete =
      doc.deletedAt ||
      new Date(doc.createdAt) > new Date(this.dataMeta.tsUpload);
    if (isRealDelete) {
      payload._deleted = true;
    }

    await this.dbLocal.put(payload);
  }

  async checkIdExist(id) {
    const doc = await this.dbLocal.getFailSafe(id);
    if (!doc) {
      return false;
    } else {
      return true;
    }
  }

  createActionBy(user) {
    // TODO clientId
    user = { ...user };
    delete user._id;
    delete user._rev;
    for (let name of ['created', 'updated', 'deleted', 'dirty']) {
      delete user[`${name}At`];
      delete user[`${name}By`];
    }
    user.clientId = this.dataMeta.clientId;
    return user;
  }

  /* data access */

  async fetchData(options = {}) {
    const res = await this.dbLocal.changes({
      live: false,
      include_docs: true,
      ...options,
    });

    const data = [];
    for (const result of res.results) {
      const doc = result.doc;
      if (doc._deleted) continue;
      if (doc.deletedAt) continue;
      data.push(doc);
    }

    return data;
  }

  async getDocuments(options = {}) {
    let data = [];
    try {
      await this.dbLocal.createIndex({
        index: { fields: options.sort },
      });
    } catch (error) {
      console.log(error);
    }
    try {
      const res = await this.dbLocal.find({
        ...options,
      });
      for (const result of res.docs) {
        data.push(result);
      }
    } catch (error) {
      console.log(error);
      const resultFetch = this.fetchData(options);
      data = resultFetch;
    }

    return data;
  }

  subscribe(callback, options = {}) {
    const onChanges = async () => {
      try {
        const data = await this.fetchData(options);
        callback(data, null);
      } catch (err) {
        callback(null, err);
      }
    };

    let debounceTimeoutId = null;

    const changesListener = this.dbLocal
      .changes({
        live: true,
        include_docs: false,
        since: 'now',
        ...options,
      })
      .on('change', () => {
        clearTimeout(debounceTimeoutId);
        debounceTimeoutId = setTimeout(onChanges, DEBOUNCE_MS);
      })
      .on('error', err => {
        console.error(err);
      });

    const unsubscribe = () => {
      clearTimeout(debounceTimeoutId);
      changesListener.cancel();
    };

    return () => unsubscribe();
  }
}

module.exports = PouchyStore;
