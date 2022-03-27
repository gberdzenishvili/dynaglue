import { CollectionLayout } from '../base/layout';
import {
  createDynamoMock,
} from '../../testutil/dynamo_mock';
import { createContext } from '../context';
import { DynamoDB } from 'aws-sdk/clients/all';
import { replace } from './replace';

describe('replace', () => {
  const layout: CollectionLayout = {
    tableName: 'my-objects',
    primaryKey: { partitionKey: 'pkey', sortKey: 'skey' },
  };
  const collection = {
    name: 'users',
    layout,
  };

  test('should replace an item conditionally', async () => {
    const ddb = createDynamoMock('putItem', {});
    const context = createContext(ddb as unknown as DynamoDB, [collection]);

    const value = { _id: 'test-id', name: 'Chris', email: 'chris@example.com' };
    const result = await replace(context, 'users', value);
    expect(result).toHaveProperty('_id');

    const request = ddb.putItem.mock.calls[0][0];
    expect(request.TableName).toBe('my-objects');
    expect(request.Item).toBeDefined();
  });
});