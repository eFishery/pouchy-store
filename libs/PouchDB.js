import IPouchDB from 'pouchdb';

export default class PouchDB extends IPouchDB {
  async getFailSafe(id) {
    try {
      const doc = await this.get(id);
      return doc;
    } catch (err) {
      if (err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  async update(id, obj) {
    const doc = await this.getFailSafe(id) || { _id: id };
    Object.assign(doc, obj);
    const info = await this.put(doc);
    return info;
  }

  static createId() {
    let id = (new Date()).getTime().toString(16);
    while (id.length < 32) {
      id += Math.random().toString(16).split('.').pop();
    }
    id = id.substr(0, 32);
    id = id.replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/, '$1-$2-$3-$4-$5');
    return id;
  }

  createId() {
    return PouchDB.createId();
  }

  async getDocs() {
    const result = await this.allDocs({
      include_docs: true,
    });
    const docs = result.rows.map(row => row.doc);
    return docs;
  }
}
