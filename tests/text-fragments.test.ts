import { describe, expect, it } from 'vitest';
import { mergeTextFragments } from '../src/view/text-fragments';

describe('rendered text fragments', () => {
  it('joins adjacent text nodes on one line while keeping a soft wrap and a blank gap distinct', () => {
    const rect = (left: number, right: number, top: number) => ({ left, right, top, bottom: top + 16 });
    const result = mergeTextFragments([rect(98, 115, 20), rect(72, 98, 20), rect(50, 70, 40), rect(140, 170, 20)]);
    expect(result).toEqual([rect(72, 115, 20), rect(140, 170, 20), rect(50, 70, 40)]);
  });
});
