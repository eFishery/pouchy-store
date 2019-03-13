import WebSqlPouchCore from 'pouchdb-adapter-websql-core';
import sqlitePlugin from 'react-native-sqlite-storage';

function createOpenDBFunction (opts) {
  return function (name, version, description, size) {
    // The SQLite Plugin started deviating pretty heavily from the
    // standard openDatabase() function, as they started adding more features.
    // It's better to just use their "new" format and pass in a big ol'
    // options object. Also there are many options here that may come from
    // the PouchDB constructor, so we have to grab those.
    var sqlitePluginOpts = Object.assign({}, opts, {
      name: name,
      version: version,
      description: description,
      size: size
    })
    return sqlitePlugin.openDatabase(sqlitePluginOpts)
  }
}

function ReactNativeSQLitePouch (opts, callback) {
  var websql = createOpenDBFunction(opts)
  var _opts = Object.assign({
    websql: websql
  }, opts)

  if ( 'default' in WebSqlPouchCore && typeof WebSqlPouchCore.default.call === 'function') {
    WebSqlPouchCore.default.call(this, _opts, callback)
  } else {
    WebSqlPouchCore.call(this, _opts, callback)
  }
}

ReactNativeSQLitePouch.valid = function () {
  // if you're using React Native, we assume you know what you're doing because you control the environment
  return true
}

// no need for a prefix in React Native (i.e. no need for `_pouch_` prefix
ReactNativeSQLitePouch.use_prefix = false

function reactNativeSqlitePlugin (PouchDB) {
  PouchDB.adapter('react-native-sqlite', ReactNativeSQLitePouch, true)
}

export default reactNativeSqlitePlugin
