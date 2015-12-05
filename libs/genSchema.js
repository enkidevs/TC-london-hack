import {parseAllFiles} from '../libs/parsing';

import {
  GraphQLID,
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLBoolean,
  GraphQLList
} from 'graphql';

import {
  connectionArgs,
  connectionDefinitions,
  connectionFromArray,
  fromGlobalId,
  globalIdField,
  mutationWithClientMutationId,
  nodeDefinitions,
} from 'graphql-relay';

let count = 0;


// http://stackoverflow.com/questions/10834796/validate-that-a-string-is-a-positive-integer
function isNormalInteger(str) {
    var n = ~~Number(str);
    return String(n) === str && n >= 0;
}

var typenames_count = {};

function sanitize(name) {
  let clean = name.replace(/\./g, '_').replace(/\//g, '_');
  if (typenames_count[clean]) {
    typenames_count[clean] = typenames_count[clean] + 1;
    clean = clean + '_' + (typenames_count[clean] - 1);
  } else {
    typenames_count[clean] = 1;
  }
  return clean;
}

function getBasicTypeFromData(field, data) {
  const vals = data.map(x => x[field]).filter(x => !!x);
  if (!vals.length) {
    return {
      description: ' \n\n Unknown type. ' +
        'Could not infer type from data because all values ' +
        'were empty',
      type: GraphQLString,
    }
  }
  if (
    vals.every(x => x == 0 || x == 1) ||
    vals.every(x => x == true || x == false)
  ) {
    data.forEach(x => {
      x[field] = (x[field] == 0) ? false : !!x[field];
    })
    return {
      description: '',
      type: GraphQLBoolean,
    }
  }
  if (vals.every(isNormalInteger)) {
    return {
      description: '\n' +
        'Min value: ' + Math.min.apply({}, vals) + '\n' +
        'Max value: ' + Math.max.apply({}, vals),
      type: GraphQLInt,
    }
  }
  return {
    description: '' +
      'Examples:\n' + vals.slice(0, 3).join('\n'),
    type: GraphQLString,
  }
}

function schemaFromArrayOfObjects(name, data, sheetSchemas, getRowFromSheetById) {
  return new GraphQLObjectType({
    name: sanitize(name),
    fields: () => {
      var firstRow = data[0];
      var fieldsFromData = {};
      // inferring types (Int or String) from first row
      Object.keys(firstRow).forEach(fieldName => {
        var val = firstRow[fieldName];
        var {type, description} = getBasicTypeFromData(fieldName, data);
        var relation = false;
        var normalizedName = fieldName;
        var sheetName = fieldName.slice(0, -2);
        if (fieldName.slice(fieldName.length - 2, fieldName.length) === 'Id') {
          normalizedName = sheetName;
          type = sheetSchemas[sheetName];
          relation = true;
        } else if (fieldName === 'id'){
          type = GraphQLID;
        }
        fieldsFromData[normalizedName] = {
          type,
          description,
          resolve: (row) => {
            if (relation) {
              return getRowFromSheetById(sheetName, row[fieldName]);
            }
            return row[fieldName];
          }
        }
      });
      return fieldsFromData;
    },
  });
}

function schemaFromSpreadSheet(name, obj, returnTheTypeOnly) {
  var sheetSchemas = {};
  var fieldsFromData = {};
  Object.keys(obj).reverse().forEach(sheetName => {
    var normalizedName = sheetName.replace(/s$/,'');
    sheetSchemas[normalizedName] = schemaFromArrayOfObjects(normalizedName, obj[sheetName], sheetSchemas,
      (sheet, id) => obj[(sheet + 's').replace(/ss$/,'s')].find(r => r.id === id));
    var args = {
      row: {
        type: GraphQLInt,
      },
    };
    var firstRow = obj[sheetName][0];
    var keys = Object.keys(firstRow);
    keys.forEach(key => {
      var val = firstRow[key];
      args[key] = {
        type: isNormalInteger(val) ? GraphQLInt : GraphQLString
      }
    })
    fieldsFromData[normalizedName] = {
      type: sheetSchemas[normalizedName],
      description: sheetName + ' sheet',
      args,
      resolve: (root, a) => {
        if (typeof(a.row) !== "undefined") {
          return obj[sheetName][a.row];
        }
        if (Object.keys(a||{}).length > 0) {
          var k = Object.keys(a)[0];
          return obj[sheetName].find(r => {
            return r[k] == a[k];
          })
        }
      },
    }
    fieldsFromData[normalizedName + 's'] = {
      type: new GraphQLList(sheetSchemas[normalizedName]),
      description: '',
      args: {
        limit:    {type: GraphQLInt},
        offset:   {type: GraphQLInt},
        sort:  {type: GraphQLString},
        sortDesc:  {type: GraphQLString},
      },
      resolve: (root, args) => {
        let data = obj[sheetName]
        if (args.sort) {
          data = data.sort((x, y) =>
            x[args.sort] >= y[args.sort] ? 1 : -1
          );
        }
        if (args.sortDesc) {
          data = data.sort((x, y) =>
            x[args.sortDesc] >= y[args.sortDesc] ? 1 : -1
          );
        }
        if (args.offset) {
          data = data.slice(args.offset);
        }
        if (args.limit) {
          data = data.slice(0, args.limit);
        }
        return data;
      },
    }
  });
  let ot = new GraphQLObjectType({
    name: sanitize(name),
    description: 'File ' + name,
    fields: () => fieldsFromData,
  });
  if (returnTheTypeOnly) {
    return ot;
  }
  return new GraphQLSchema({
    query: ot
  });
}

function schemaFromSpreadSheetsObj(data) {
  typenames_count = {};
  var fieldsFromData = {};
  Object.keys(data).forEach(k => {
    fieldsFromData[k] = {
      name: k,
      type: schemaFromSpreadSheet(k, data[k], true),
      resolve: () => data[k],
    }
  });
  if (!Object.keys(data).length) {
    fieldsFromData = {
      no_data: {
        name: 'no_data',
        description: 'No API yet',
        type: GraphQLString,
        resolve: () => 'no data'
      }
    };
  }
  return new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'root',
      fields: () => fieldsFromData,
    }),
  });
}

function genSchema() {
  const data = parseAllFiles('./.cached_files');
  global.graphQLSchema = schemaFromSpreadSheetsObj(data);
}

module.exports.schemaFromSpreadSheet = schemaFromSpreadSheet;
module.exports.schemaFromSpreadSheetsObj = schemaFromSpreadSheetsObj;
module.exports.genSchema = genSchema;
