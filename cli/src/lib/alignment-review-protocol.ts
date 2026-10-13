// The contract between the review server in `acstack align` and the viewer page it serves.
// Both sides import these, so a rename on one side cannot silently break the other.
export const PACK_DATA_ID = 'alignment-pack-data';
export const REVIEW_PATH = '/api/review';
export const REVIEW_TOKEN_HEADER = 'x-review-token';
export const REVIEW_TOKEN_META = 'acstack-review-token';
