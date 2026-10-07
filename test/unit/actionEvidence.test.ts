import { expect, it } from 'vitest';
import { RingBuffer } from '../../src/collectors/ringBuffer.js';

it('uses monotonic cursors across clear and partial removals', () => {
  const buffer = new RingBuffer<number>(2);
  buffer.push(1);
  const checkpoint = buffer.cursor;
  buffer.clear();
  buffer.push(2);
  buffer.push(3);
  expect(buffer.since(checkpoint)).toEqual({ records: [2, 3], dropped: 0 });
  buffer.push(4);
  expect(buffer.since(checkpoint)).toEqual({ records: [3, 4], dropped: 1 });
  buffer.remove((value) => value === 3);
  buffer.push(5);
  expect(buffer.since(checkpoint)).toEqual({ records: [4, 5], dropped: 2 });
});
