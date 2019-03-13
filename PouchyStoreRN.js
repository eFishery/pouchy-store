import PouchDB from './libs/PouchDB.js';
import IPouchyStore from './PouchyStore.js';
import reactNativeSqlitePlugin from './libs/pouchdb-adapter-react-native-sqlite';

PouchDB.plugin(reactNativeSqlitePlugin);

export default class PouchyStore extends IPouchyStore {
  constructor() {
    super();
    this.optionsLocal.adapter = 'react-native-sqlite';
  }
}
