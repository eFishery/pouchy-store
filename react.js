import React from 'react';

export const usePouchy = (store, options = {}) => {
  const [data, setData] = React.useState([]);
  const refStore = React.useRef(store);
  const optionsJson = JSON.stringify(options);

  React.useEffect(() => {
    const optionsObj = JSON.parse(optionsJson);

    if (store.isInitialized) {
      (async () => {
        const newData = await refStore.current.getDocuments(optionsObj);
        setData(newData);
      })();

      return refStore.current.subscribe(() => {
        const newData = await refStore.current.getDocuments(optionsObj);
        setData(newData);
      }, optionsObj);
    }
  }, [store.isInitialized, optionsJson]);

  return [data];
};
