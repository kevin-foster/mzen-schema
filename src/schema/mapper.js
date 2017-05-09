'use strict'
var clone = require('clone');
var ObjectID = require('bson-objectid');
var SchemaUtil = require('./util');
var Types = require('./types');
var TypeCaster = require('../type-caster');

const queryOperators = [
  '$eq', 
  '$gt', 
  '$gte', 
  '$lt', 
  '$lte', 
  '$ne', 
  '$in', 
  '$nin', 
  '$or', 
  '$and', 
  '$not', 
  '$nor', 
  '$size', 
  '$all', 
  '$elemMatch'
];

class SchemaMapper
{
  constructor(spec, options) 
  {
    this.spec = (spec == undefined) ? {} : spec;
    this.options = (options == undefined) ? {} : options;
  }
  map(object, callback)
  {
    const meta = {path: '', errors: {}};
    const isArray = Array.isArray(object);
    const objects = isArray ? object : [object];
    // Clone the spec as it may be temporarily modified in the process of validation
    const spec = clone(this.spec);
    
    objects.forEach(function(object, x){
      this.mapField(spec, x, objects, meta, callback);
    }, this);
  }
  mapPaths(paths, callback, meta)
  {
    var meta = meta ? meta : {path: '', errors: {}};
    var objects = Array.isArray(paths) ? paths : [paths];

    meta['path'] = meta['path'] ? meta['path'] : '';
    objects.forEach(function(object){
      for (let fieldPath in object) {
        if (!object.hasOwnProperty(fieldPath)) continue;
        meta['path'] = fieldPath;
        var spec = SchemaUtil.getSpec(fieldPath, this.spec);
        this.mapField(spec, fieldPath, object, meta, callback);
      }
    }.bind(this));
  }
  mapQueryPaths(query, callback)
  {
    const mapRecursive = (query) => {
      if (TypeCaster.getType(query) == Object) {
        for (let fieldName in query) {
          if (!query.hasOwnProperty(fieldName)) continue;
          if (this.isQueryOperator(fieldName)) {
            // If this element is an operator - we want to validate is values
            if (['$or', '$and'].indexOf(fieldName) != -1) {
              query[fieldName].forEach(function(value, x){
                mapRecursive(query[fieldName][x]);
              }.bind(this));
            } else {
              mapRecursive(query[fieldName]);
            }
          } else {
            // Check if has a query opterator
            var hasOpertators = false;
            if (TypeCaster.getType(query[fieldName]) == Object) {
              for (var childField in query[fieldName]) {
                hasOpertators = hasOpertators || (queryOperators.indexOf(childField) !== -1);
                if (hasOpertators) {
                  if (Array.isArray(query[fieldName][childField])) {
                    query[fieldName][childField].forEach(function(value, x){
                      callback(fieldName, x, query[fieldName][childField]);
                    }.bind(this));
                  } else {
                      callback(fieldName, childField, query[fieldName]);
                  }
                }
              }
            }
            if (!hasOpertators) {
              if (Array.isArray(query[fieldName])) {
                query[fieldName].forEach(function(value, x){
                  callback(fieldName, x, query[fieldName]);
                }.bind(this));
              } else {
                callback(fieldName, fieldName, query);
              }
            }
          }
        }
      } else if (Array.isArray(query)) {
        query.forEach(function(arrayValue, x){
          mapRecursive(query[x], meta);
        }.bind(this));
      } 
      return query;
    };
    
    mapRecursive(query);
  }
  mapRecursive(spec, object, meta = {}, callback)
  {
    meta['path'] = (meta['path'] == undefined) ? '' : meta['path'];
  
    // If match all spec is defined, newSpec defaults to an empty object since any spec rules should be replaced by 
    // - the match-all defaults to original spec
    const matchAllSpec = (spec && spec['*'] != undefined) ? spec['*'] : undefined;
    const newSpec = (matchAllSpec != undefined) ? {} :  spec;
    for (var fieldName in object) {
      if (!object.hasOwnProperty(fieldName)) continue;
      
      if (matchAllSpec !== undefined) {
        // If match all '*' field spec is set, we generate a new spec object using the match all spec for every field
        newSpec[fieldName] = matchAllSpec;
      } else if (spec === undefined || spec[fieldName] === undefined) {
        // Any properties of the object under validation, that are not defined defined in the spec
        // - are injected into the spec as "undefined" to allow default validations to be applied
        // If no spec is specified, all fields are set as undefined. This allows default validations to be applied.
        newSpec[fieldName] = undefined;
      }
    }
    spec = newSpec;

    var basePath = meta['path'];

    for (var fieldName in spec) {
      if (!spec.hasOwnProperty(fieldName)) continue;
      if (fieldName.indexOf('$') === 0) continue; // Descriptor proptery
      meta['path'] = basePath ? basePath + '.' + fieldName : fieldName;
      this.mapField(spec[fieldName], fieldName, object, meta, callback);
    }
  }
  mapArrayElements(spec, array, meta = {}, callback)
  {
    meta['path'] = (meta['path'] == undefined) ? '' : meta['path'];

    var basePath = meta['path'];
    array.forEach(function(element, x){
      meta['path'] = basePath + '[' + x + ']';
      this.mapField(spec, x, array, meta, callback);
    }, this);
  }
  mapField(spec, fieldName, container, meta = {}, callback)
  {
    meta['path'] = (meta['path'] == undefined) ? '' : meta['path'];
    
    var fieldType = undefined;
    // If the field type is a string value then it should contain the string name of the required type (converted to a constructor later). 
    // - Otherwise we need to find the constructor, if the value is not already a constructor ([] or {}) 
    if (spec) fieldType = spec.constructor == String ? spec : TypeCaster.getType(spec);
    if (fieldType == Object && spec['$type'] !== undefined) fieldType = spec['$type'];
    if (fieldType && fieldType.constructor == String) { 
      // The fieldType was specified with a string value (not a String constructor)
      // Attempt to covert the field type to a constructor
      fieldType = Types[fieldType];
    }

    var defaultValue = undefined;
    if (fieldType == Object) {
      defaultValue = {};
    } else if (fieldType == Array) {
      defaultValue = [];
    }
    if (container[fieldName] === undefined && defaultValue !== undefined) {
      container[fieldName] = defaultValue;
    }
  
    callback(spec, fieldName, container, meta['path']);

    const path = meta['path'];
    switch (fieldType) {
      case Object:
        this.mapRecursive(spec, container[fieldName], meta, callback);
      break;
      case Array:
        var arraySpec  = undefined;
        if (Array.isArray(spec) && spec[0]) {
          // If the field is an array the specification for the array elements shoud be contained in the first element
          arraySpec = spec[0];
        } else if (TypeCaster.getType(spec) == Object && spec['$spec']) {
          // If the field type is an object which specifies type "Array" 
          // - then the array elements spec should be specified using the "$spec" property 
          arraySpec = spec['$spec'];
        }
        if (arraySpec) {
          this.mapArrayElements(arraySpec, container[fieldName], meta, callback);
        }
      break;
    }
  }
  isQueryOperator(value) 
  {
    return (typeof value == 'string' && value[0] == '$');
  }
}

module.exports = SchemaMapper;