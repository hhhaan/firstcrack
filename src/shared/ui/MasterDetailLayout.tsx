import type { ReactNode } from 'react';

function Root({ children }: { children: ReactNode }) {
    return (
        <div
            className="grid min-w-0 items-start gap-5"
            style={{ gridTemplateColumns: 'minmax(0, 350px) minmax(0, 1fr)' }}
        >
            {children}
        </div>
    );
}

function Master({ children }: { children: ReactNode }) {
    return <div className="min-w-0">{children}</div>;
}

function Detail({ children }: { children?: ReactNode }) {
    return <div className="min-w-0 sticky top-6">{children}</div>;
}

function Empty({ children }: { children?: ReactNode }) {
    if (!children) {
        return <div className="min-w-0 sticky top-6" />;
    }
    return (
        <div className="min-w-0 sticky top-6">
            <div className="bg-main-bg rounded-lg py-15 px-8 flex items-center justify-center text-muted text-sm dark:border dark:border-[#585d61]">
                {children}
            </div>
        </div>
    );
}

export const MasterDetail = {
    Root,
    Master,
    Detail,
    Empty,
};

export const MasterDetailLayout = ({
    left,
    detail,
    placeholder,
}: {
    left: ReactNode;
    detail?: ReactNode | null;
    placeholder?: ReactNode;
}) => (
    <MasterDetail.Root>
        <MasterDetail.Master>{left}</MasterDetail.Master>
        {detail ? (
            <MasterDetail.Detail>{detail}</MasterDetail.Detail>
        ) : placeholder ? (
            <MasterDetail.Empty>{placeholder}</MasterDetail.Empty>
        ) : (
            <MasterDetail.Detail />
        )}
    </MasterDetail.Root>
);
