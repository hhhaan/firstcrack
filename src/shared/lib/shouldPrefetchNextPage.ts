/** Gate for the extra active useQuery that prefetches page N+1 of a server-offset list. */
export const shouldPrefetchNextPage = ({
    enabled,
    page,
    pageSize,
    total,
    isSuccess,
    isPlaceholderData,
}: {
    enabled: boolean;
    page: number;
    pageSize: number;
    total: number | undefined;
    isSuccess: boolean;
    isPlaceholderData: boolean;
}): boolean => {
    if (!enabled || !isSuccess || isPlaceholderData || total === undefined || pageSize <= 0) return false;
    const totalPages = Math.ceil(total / pageSize);
    if (page >= totalPages) return false;
    return page * pageSize < total;
};
