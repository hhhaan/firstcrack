/**
 * F3: green roast deduction is claimed once per logical roast.
 * Schedule complete uses reference_id = plan_batch.id; session save uses session.id.
 * If either ref already has a roast event, a second deduct must not apply.
 *
 * Mirrors server `roast_already_deducted` / client hasRoastDeductionForReference guard.
 */
export function isGreenRoastAlreadyClaimed(
    existingRoastReferenceIds: Iterable<string>,
    candidateReferenceId: string,
    linkedBatchId?: string | null,
): boolean {
    const claimed =
        existingRoastReferenceIds instanceof Set ? existingRoastReferenceIds : new Set(existingRoastReferenceIds);
    if (claimed.has(candidateReferenceId)) return true;
    if (linkedBatchId && claimed.has(linkedBatchId)) return true;
    return false;
}
