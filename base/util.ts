import get from 'lodash/get';
import { Context } from '../context';
import { CollectionNotFoundException, InvalidIdException, PersistenceException, InvalidParentIdException } from './exceptions';
import { DocumentWithId, WrappedDocument } from './common';
import newId from './new_id';
import { KeyPath, describeKeyPath, AccessPatternOptions } from './access_pattern';
import { CollectionDefinition, ChildCollectionDefinition, RootCollectionDefinition } from './collection_definition';

export const SEPARATOR = '|-|';

export type IndexedValue = string | undefined;

export const assemblePrimaryKeyValue = (collectionName: string, _id: string): string =>
  `${collectionName}${SEPARATOR}${_id}`;

// FIXME: distinguish correctly between:
//  - sparse keys - a value is not always written to the all the key fields (from DynamoDB's persective, not optional sort
//                  key values) which leverages DynamoDB's behaviour to not index the record in that GSI
//  - empty key value - an access pattern mapped to a partition+sort defined GSI but that only has partition key values
//                   needs a "dummy" value in the sort key slot so it gets indexed, and not treated like a sort key

export const assembleIndexedValue = (type: 'partition' | 'sort', collectionName: string, values: (string | undefined)[]): IndexedValue => {
  if (values.length === 0) {
    // empty key value
    return collectionName;
  } else if (values.every(value => typeof value === 'undefined')) {
    // sparse key? - keep the value blank to avoid showing up in searches
    return undefined;
  }
  return `${collectionName}${SEPARATOR}${values.map(x => typeof x === 'string' ? x : '').join(SEPARATOR)}`;
};

export const getRootCollection = (context: Context, collectionName: string): RootCollectionDefinition => {
  const c = context.rootDefinitions.get(collectionName);
  if (!c) throw new CollectionNotFoundException(collectionName);
  return c;
};

export const getChildCollection = (context: Context, collectionName: string): ChildCollectionDefinition => {
  const c = context.childDefinitions.get(collectionName);
  if (!c) throw new CollectionNotFoundException(collectionName);
  return c;
};

export const getCollection = (context: Context, collectionName: string): CollectionDefinition => {
  const c = context.definitions.get(collectionName);
  if (!c) throw new CollectionNotFoundException(collectionName);
  return c;
};

export const constructKeyValue = (
  type: 'partition' | 'sort',
  collectionName: string,
  valuePaths: KeyPath[],
  options: AccessPatternOptions,
  value: DocumentWithId
): string|undefined => {
  const values = valuePaths.map(valuePath => {
    const extractedValue = get(value, valuePath);
    if (typeof extractedValue !== 'undefined' && typeof extractedValue !== 'string') {
      throw new PersistenceException(
        `Indexed value at path ${describeKeyPath(valuePath)} was not a string for collection ${collectionName}`
      );
    }
    const transformedValue = options.stringNormalizer && extractedValue ?
      options.stringNormalizer(valuePath, extractedValue) : extractedValue;
    return transformedValue;
  });

  return assembleIndexedValue(type, collectionName, values);
};

export const toWrapped = (
  collection: CollectionDefinition,
  value: { [key: string]: any }
): WrappedDocument => {
  let updatedValue: DocumentWithId;
  if (typeof value._id !== 'undefined') {
    if (typeof value._id !== 'string') {
      throw new InvalidIdException(value._id);
    }
    updatedValue = value as DocumentWithId;
  } else {
    updatedValue = { ...value, _id: newId() };
  }

  const extractedKeys = collection.wrapperExtractKeys
    .map(({ type, key, valuePaths, options }) => {
      const keyValue = constructKeyValue(type, collection.name, valuePaths, options, updatedValue);
      if (typeof keyValue !== undefined) {
        return { [key]: keyValue };
      }
    })
    .filter(x => typeof x !== 'undefined');

  let partitionKeyValue;
  let sortKeyValue;
  if (collection.type === 'child') {
    const parentId = get(value, collection.foreignKeyPath);
    if (typeof parentId !== 'string') {
      throw new InvalidParentIdException(parentId, collection.name, collection.parentCollectionName);
    }
    partitionKeyValue = assemblePrimaryKeyValue(collection.parentCollectionName, parentId);
    sortKeyValue = assemblePrimaryKeyValue(collection.name, updatedValue._id);
  } else {
    partitionKeyValue = sortKeyValue = assemblePrimaryKeyValue(collection.name, updatedValue._id);
  }

  const wrapped = Object.assign({
    [collection.layout.primaryKey.partitionKey]: partitionKeyValue,
    [collection.layout.primaryKey.sortKey]: sortKeyValue,
    value: updatedValue,
  }, ...extractedKeys);
  return wrapped;
};

export const unwrap = (document: WrappedDocument): DocumentWithId => {
  return document.value;
};