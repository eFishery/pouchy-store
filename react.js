import React from 'react';

export const usePouchy = (store, options = {}, id = null) => {
  const [data, setData] = React.useState([]);
  const refStore = React.useRef(store);
  // const refOptions = React.useRef(options);

  React.useEffect(() => {
    if (store.isInitialized) {
      (async () => {
        const newData = await refStore.current.getDocuments(options);
        setData(newData);
      })();

      return refStore.current.subscribe(newData => {
        setData(newData);
      }, options);
    }
  }, [store.isInitialized, id]);

  return [data];
};
