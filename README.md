# Pouchy Store

Pouchy Store is a library to help developer create [Offline First](http://offlinefirst.org/) apps out of the box with synchronizing capabilities locally-remotely. Pouchy Store could be used for NodeJS/ReactJS and ReactNative. Pouchy Store built on top of PouchDB (local) and CouchDB (remote) stack.

## How To Use

Install this library using
`npm i pouchy-store`

Import `PouchyStore` from library in your Model Class
```
import PouchyStore from 'pouchy-store';

class ModelStore extends PouchyStore {
  get name() {
    return this._name;
  }

  setName(dbName) {
    this._name = dbName;
  }

  get urlRemote() {
    return "http://couch-remote-url.com";
  }

  get optionsRemote() {
    return {
      auth: {
	    username: 'admin',
	    password: 'adminpassword',
	  }
    };
  }
}

export default new ModelStore();
```
Use your model class in your app (React Example)
```
import modelStore from 'ModelStore';

class App extends React {
	async componentDidUpdate() {
		if (!modelStore.isInitialized) {
		  modelStore.setName("dbName");	// to set databasename for model
		  await modelStore.initialize(); // to initialize database locally by getting synced
		}
	}

	render() {
        modelStore.data.forEach(item => console.log(item)); // access all the data in store
		modelStore.countUnuploadeds(); // to show number of unoploaded/synced items
		modelStore.dataMeta.tsUpload; // to show last timestamp uploaded/synced
		await modelStore.addItem({
          someField: 'someValue',
          anotherField: 'anotherValue',
        });
		await modelStore.deleteItem();
		await modelStore.upload(); // to upload/sync database local-remote
	}

	componentDidMount() {
		this.unsubTodos = modelStore.subscribe(this.rerender); // set callback when there is a change in store's data
	}

	componentWillUnmount() {
		this.unsubTodos();
		await modelStore.deinitialize(); // to destroy database locally if it's needed
	}

	rerender = () => {
        this.setState({
          _rerender: new Date(),
        });
    }
}
```
Available API for CRUD operation:
```
	/* manipulation of array data (non-single) */
	addItem(payload)
	addItemWithId(id, payload)
	editItem(id, payload)
	deleteItem(id)

	/* manipulation of single data (non-array) */
	editSingle(payload)
	deleteSingle()
```


## Code Example
[Pouchy Store Example on React](https://github.com/eFishery/pouchy-store-example)

## Contributor

[Dimas Gilang Saputra](https://github.com/sumartoyo)  
[Anshorimuslim](https://github.com/ans-4175)  

## Credits

[PouchDB](https://pouchdb.com/)  
[CouchDB](http://couchdb.apache.org/)  
[React Native SQLite Storage](https://www.npmjs.com/package/react-native-sqlite-storage)  

## License
MIT
