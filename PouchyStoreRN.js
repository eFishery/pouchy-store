import PouchDB from './libs/PouchDB.js';
import IPouchyStore from './PouchyStore.js';
import SQLite from 'react-native-sqlite-2';
import SQLiteAdapterFactory from 'pouchdb-adapter-react-native-sqlite';

const SQLiteAdapter = SQLiteAdapterFactory(SQLite);
PouchDB.plugin(SQLiteAdapter);

export default class PouchyStore extends IPouchyStore {
  constructor() {
    super();
    this.optionsLocal.adapter = 'react-native-sqlite';
  }
}
