# Security Specification: Worksheets

## 1. Data Invariants
- A Worksheet must belong to an authenticated creator (`userId`).
- The document ID must be valid and secure (`isValidId`).
- `createdAt` must be strictly set to the server timestamp (`request.time`).
- Questions must be a list of formatted structures.
- Users can only read, write, update, or delete worksheets that they own.

## 2. The Dirty Dozen Payloads (Worksheet Attacks)
Below are malicious payloads designed to attempt to bypass the rules:
1. **Identity Spoofing**: Attempt to create a worksheet with `userId = "victim_uid"` while authenticated as `attacker_uid`.
2. **Anonymous Access Attempt**: Attempt to create a worksheet without being logged in.
3. **Invalid ID Poisoning**: Create a worksheet with a 1.5KB long malformed string as the document ID.
4. **Incorrect Date Attempt**: Create with a client-supplied past or future `createdAt` value.
5. **No Questions Schema**: Create a worksheet with `questions` field as a string instead of a list.
6. **Malicious Keys Update**: Attempt to update a worksheet with random un-allowed metadata fields.
7. **Read other user worksheet**: Retrieve another user's worksheet.
8. **Delete other user worksheet**: Try to delete another user's worksheet.
9. **Update other user's worksheet**: Try to update another user's worksheet with a payload.
10. **Untrusted list access query**: Attacking query with list on all user worksheets.
11. **Massive string poisoning**: Injecting a giant title (e.g. 10MB) to cause DoW attacks.
12. **Status bypass**: Attempt to modify the ID, userId or core immutable fields in update.

## 3. Security Rules Implementation Tests
The rules must return `PERMISSION_DENIED` on each of these 12 malicious payloads, confirming strict validation.
