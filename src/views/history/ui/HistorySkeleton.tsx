import { Skeleton } from '@shared/ui/Skeleton';

const ROW_COUNT = 10;

const skeletonCols = [
    { width: '100px', hideOnMd: false, height: 14, ratio: '60%' },
    { width: '200px', hideOnMd: false, height: 14, ratio: '80%' },
    { width: '150px', hideOnMd: true, height: 14, ratio: '70%' },
    { width: '90px', hideOnMd: false, height: 14, ratio: '60%' },
    { width: '80px', hideOnMd: false, height: 14, ratio: '60%' },
    { width: '90px', hideOnMd: false, height: 14, ratio: '60%' },
    { width: '110px', hideOnMd: false, height: 22, borderRadius: '9999px', ratio: '60%' },
    { width: '60px', hideOnMd: false, height: 18, borderRadius: '50%' },
];

export const HistorySkeleton = () => (
    <div className="overflow-x-auto rounded-2xl border border-border bg-main-bg">
        <table className="min-w-250 w-full table-fixed border-collapse md:min-w-200 lg:min-w-250">
            <thead>
                <tr className="border-b border-divider dark:border-[#585d61]">
                    {skeletonCols.map((col, i) => (
                        <th
                            key={i}
                            className={`px-3 py-3 text-left ${col.hideOnMd ? 'md:hidden lg:table-cell' : ''}`}
                            style={{ width: col.width }}
                        >
                            <Skeleton width={col.width} height={10} borderRadius="4px" />
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {Array.from({ length: ROW_COUNT }, (_, rowIdx) => (
                    <tr key={rowIdx} className="border-b border-divider dark:border-[#585d61]">
                        {skeletonCols.map((col, colIdx) => (
                            <td
                                key={colIdx}
                                className={`px-3 py-3 ${col.hideOnMd ? 'md:hidden lg:table-cell' : ''}`}
                                style={{ width: col.width }}
                            >
                                <Skeleton
                                    width={col.borderRadius ? col.width : col.ratio}
                                    height={col.height}
                                    borderRadius={col.borderRadius ?? '4px'}
                                />
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);
