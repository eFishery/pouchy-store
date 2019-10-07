import PouchDB from './libs/PouchDB';
import generateReplicationId from './libs/generateReplicationId';
import checkInternet from './libs/checkInternet';

console.e = console.log;

const ID_META_DOC = 'meta';
const PREFIX_META_DB = 'meta_';

/*

class options: create getter fo these:
- `this.isUseData` boolean: give false if you do not want to mirror db data to this.data. default to true.
- `this.isUseRemote` boolean: give false if you do not want to sync with remote db. default to true.
- `this.optionsRemote` optional: give object as options for remote db constructor.
- `this.optionsLocal` optional
- `this.single` string: give string if you want single doc, not list. this is the ID of the doc. default to undefined.
- `this.dataDefault` optional: give array as default data, or object if single. default to `[]` if not single and `{}` if single.
- `this.sortData` optional: function that will be called whenever there is any changes to `this.data`. must be mutable to the data.

*/

export default class PouchyStore {
  constructor() {
    // set default options
    if (!('isUseData' in this)) {
      this.isUseData = true;
    }
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
    // initialize in-memory data
    if (this.single) {
      this.data = this.dataDefault || {};
    } else if (this.isUseData) {
      this.data = this.dataDefault || [];
    }

    this.dataMeta = { // metadata of this store
      _id: ID_META_DOC,
      clientId: PouchDB.createId(),
      tsUpload: new Date(0).toJSON(),
      unuploadeds: {},
    };
    this.changeFromRemote = {}; // flag downloaded data from remote DB
    this.subscribers = []; // subscribers of data changes

    this.dbLocal = null;
    this.dbMeta = null;
    this.dbRemote = null;
  }

  async initialize() {
    if (this.isInitialized) return;

    if (!this.name) {
      throw new Error('store must have name');
    }

    // initalize the databases
    this.dbLocal = new PouchDB(this.name, {
      auto_compaction: true,
      revs_limit: 2,
      ...this.optionsLocal,
    });
    this.dbMeta = new PouchDB(`${PREFIX_META_DB}${this.name}`, {
      auto_compaction: true,
      revs_limit: 2,
    });
    if (this.isUseRemote) {
      if (!this.urlRemote) {
        throw new Error(`store's urlRemote should not be ${this.urlRemote}`);
      }
      this.dbRemote = new PouchDB(`${this.urlRemote}${this.name}`, {
        ...this.optionsRemote,
      });
    }

    // init metadata
    const dataMetaOld = await this.dbMeta.getFailSafe(ID_META_DOC);
    if (dataMetaOld) {
      this.dataMeta = dataMetaOld;
    } else {
      await this.persistMeta();
      this.dataMeta = await this.dbMeta.getFailSafe(ID_META_DOC);
    }
    this.watchMeta();

    if (this.isUseRemote) {
      // sync data local-remote
      try {
        await checkInternet(this.urlRemote);
        await this.dbLocal.replicate.from(this.dbRemote, {
          batch_size: 1000,
          batches_limit: 2,
        });
      } catch (err) {
        console.e(err);
      }
      await this.initUnuploadeds();
    }

    // init data from PouchDB to memory
    const docs = await this.dbLocal.getDocs();
    if (this.single) {
      this.data = docs.find(doc => doc._id === this.single) || this.data;
    } else if (this.isUseData) {
      this.data = docs.filter(doc => !('deletedAt' in doc) || doc.deletedAt === null);
      this.sortData(this.data);
      this.data = this.filterData(this.data)
    }

    this.isInitialized = true;
    if (this.single || this.isUseData) {
      this.notifySubscribers(this.data);
    } else {
      this.notifySubscribers(docs);
    }

    this.watchRemote();
    this.watchLocal();
  }

  async deinitialize() {
    this.unwatchMeta();
    this.unwatchLocal();
    this.unwatchRemote();
    await this.dbLocal.close();
    await this.dbMeta.close();
    if (this.dbRemote) {
      await this.dbRemote.close();
    }
    this.initializeProperties();
    this.isInitialized = false;
  }

  updateMemory(doc) {
    if (!this.isUseData) return;

    if (this.single) {
      if (doc._id === this.single) {
        this.data = doc;
      }
    } else {
      const isDeleted = doc.deletedAt || doc._deleted;
      const index = this.data.findIndex(item => item._id === doc._id);
      if (index !== -1) {
        if (isDeleted) {
          this.data.splice(index, 1);
        } else {
          this.data[index] = doc;
        }
      } else {
        if (isDeleted) {
          // do nothing
        } else {
          this.data.push(doc);
        }
      }
      this.sortData(this.data);
      this.data = this.filterData(this.data);
    }
  }

  sortData(data) {
    // do no sorting, override this method to sort
  }
  filterData(data) {
    return data;
    //do no filter, override this method to filter
  }
  async persistMeta() {
    try {
      await this.dbMeta.put(this.dataMeta);
    } catch (err) {
      console.e(err);
    }
  }

  async initUnuploadeds() {
    if (!this.isUseRemote) return;

    try {
      const replicationId = this.replicationId || await generateReplicationId(this.dbLocal, this.dbRemote, {});
      const replicationDoc = await this.dbLocal.get(replicationId);
      const unuploadeds = await this.dbLocal.changes({
        since: replicationDoc.last_seq,
        include_docs: true,
      });
      for (let result of unuploadeds.results) {
        const doc = result.doc;
        this.dataMeta.unuploadeds[doc._id] = true;
      }
      if (unuploadeds.results.length > 0) {
        this.persistMeta();
      }
    } catch (err) {
      console.e(err);
    }
  }

  /* watch manager for local DB and remote DB */

  watchRemote() {
    if (!this.isUseRemote) return;

    this.handlerRemoteChange = this.dbLocal.replicate.from(this.dbRemote, {
      live: true,
      retry: true,
    }).on('change', change => {
      for (let doc of change.docs) {
        this.changeFromRemote[doc._id] = true;
        this.updateMemory(doc);
      }
      this.notifySubscribers(change.docs);
    }).on('error', err => {
      console.e(`${this.name}.from`, 'error', err);
    })
  }

  unwatchRemote() {
    if (this.handlerRemoteChange) {
      this.handlerRemoteChange.cancel();
    }
  }

  watchLocal() {
    this.handlerLocalChange = this.dbLocal.changes({
      since: 'now',
      live: true,
      include_docs: true,
    }).on('change', change => {
      const doc = change.doc;
      if (this.changeFromRemote[doc._id]) {
        delete this.changeFromRemote[doc._id];
      } else {
        this.updateMemory(doc);
        if (doc._deleted) {
          delete this.dataMeta.unuploadeds[doc._id];
          this.persistMeta();
        } else if (doc.dirtyBy && doc.dirtyBy.clientId === this.dataMeta.clientId) {
          this.dataMeta.unuploadeds[doc._id] = true;
          this.persistMeta();
        }
        this.notifySubscribers([ doc ]);
      }
    }).on('error', err => {
      console.e(`${this.name}.changes`, 'error', err);
    });
  }

  unwatchLocal() {
    if (this.handlerLocalChange) {
      this.handlerLocalChange.cancel();
    }
  }

  watchMeta() {
    this.handlerMetaChange = this.dbMeta.changes({
      since: 'now',
      live: true,
      include_docs: true,
    }).on('change', change => {
      const doc = change.doc;
      if (doc._id !== ID_META_DOC) return;
      this.dataMeta = doc;
    }).on('error', err => {
      console.e(`${PREFIX_META_DB}${this.name}.changes`, 'error', err);
    });
  }

  unwatchMeta() {
    if (this.handlerMetaChange) {
      this.handlerMetaChange.cancel();
    }
  }

  /* data upload (from local DB to remote DB) */

  checkIsUploaded(doc) {
    return !(doc._id in this.dataMeta.unuploadeds);
  }

  countUnuploadeds() {
    const keys = Object.keys(this.dataMeta.unuploadeds);
    return keys.length;
  }

  async upload() {
    if (!this.isUseRemote) return;

    await checkInternet(this.urlRemote);

    await this.dbLocal.replicate.to(this.dbRemote);
    const ids = Object.keys(this.dataMeta.unuploadeds);
    for (let id of ids) {
      delete this.dataMeta.unuploadeds[id];
    }
    this.dataMeta.tsUpload = new Date().toJSON();
    this.persistMeta();
    this.notifySubscribers([]);
  }

  /* manipulation of array data (non-single) */

  async addItem(payload, user=null) {
    const id = this.dbLocal.createId();
    await this.addItemWithId(id, payload, user);
  }

  async addItemWithId(id, payload, user={}) {
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

  async editItem(id, payload, user={}) {
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

  async deleteItem(id, user={}) {
    const now = new Date().toJSON();
    const actionBy = this.createActionBy(user);
    const doc = await this.dbLocal.getFailSafe(id);
    if (!doc) return;

    const isRealDelete = doc.deletedAt || doc.createdAt > this.dataMeta.tsUpload;
    if (isRealDelete) {
      await this.dbLocal.remove(doc);
    } else {
      await this.dbLocal.put({
        ...doc,
        dirtyAt: now,
        dirtyBy: actionBy,
        deletedAt: now,
        deletedBy: actionBy,
      });
    }
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
    user = { ...user };
    delete user._id;
    delete user._rev;
    for (let name of [ 'created', 'updated', 'deleted', 'dirty' ]) {
      delete user[`${name}At`];
      delete user[`${name}By`];
    }
    user.clientId = this.dataMeta.clientId;
    return user;
  }

  /* manipulation of single data (non-array) */

  async editSingle(payload) {
    const doc = await this.dbLocal.getFailSafe(this.single) || { _id: this.single };
    await this.dbLocal.put({
      ...doc,
      ...payload,
    });
  }

  async deleteSingle() {
    const doc = await this.dbLocal.getFailSafe(this.single) || { _id: this.single };
    const payload = {};
    if (doc._rev) {
      payload._rev = doc._rev;
      Object.assign(payload, this.dataDefault || {});
    }
    await this.dbLocal.put({
      _id: doc._id,
      ...payload,
    });
  }

  /* subscription manager */

  subscribe(subscriber) {
    const index = this.subscribers.findIndex(item => item === subscriber);
    if (index !== -1) return;

    this.subscribers.push(subscriber);
    return () => this.unsubscribe(subscriber);
  }

  unsubscribe(subscriber) {
    const index = this.subscribers.findIndex(item => item === subscriber);
    if (index === -1) return;

    this.subscribers.splice(index, 1);
  }

  notifySubscribers(docs) {
    if (!this.isInitialized) return;

    if (this.isUseData) {
      // create new array/object reference
      if (this.single) {
        this.data = { ...this.data };
      } else {
        this.data = Array.from(this.data);
      }
    }
    for (let subscriber of this.subscribers) {
      try {
        subscriber(docs);
      } catch (err) {
        console.e(err);
      }
    }
  }
}
