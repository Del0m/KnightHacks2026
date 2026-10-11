import { examplePosts } from '../examples';
import { postType, medalTier } from '../feedApi';
it('has ten distinct preview posts spanning all types and medals', () => {
 expect(examplePosts).toHaveLength(10);
 expect(new Set(examplePosts.map(p => p.id)).size).toBe(10);
 expect(new Set(examplePosts.map(postType))).toEqual(new Set(['custom', 'medal', 'pr']));
 expect(new Set(examplePosts.map(medalTier).filter(Boolean))).toEqual(new Set(['bronze', 'silver', 'gold']));
 expect(examplePosts.every(p => p.id.startsWith('example-'))).toBe(true);
});
