import ObjectID from 'bson-objectid';

class Mixed {}

export const Types = {
  String: String,
  Number: Number,
  Boolean: Boolean,
  Array: Array,
  Object: Object,
  Date: Date,
  ObjectID: ObjectID,
  Mixed: Mixed
};

export default Types;
