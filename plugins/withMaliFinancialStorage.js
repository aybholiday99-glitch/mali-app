const { withGradleProperties } = require('expo/config-plugins');
// A ceiling, not preallocated disk. Chunked current/previous vaults and retained
// conflicts can exceed AsyncStorage's default 6MiB. Storage exhaustion still fails closed.
module.exports = config => withGradleProperties(config,config=>{
  config.modResults=config.modResults.filter(row=>row.type!=='property' || row.key!=='AsyncStorage_db_size_in_MB');
  config.modResults.push({type:'property',key:'AsyncStorage_db_size_in_MB',value:'256'});
  return config;
});
