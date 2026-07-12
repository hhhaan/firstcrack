import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { Component, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
    onReset?: () => void;
    fallback?: (props: { error: Error; reset: () => void }) => ReactNode;
}

interface State {
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    reset = () => {
        this.props.onReset?.();
        this.setState({ error: null });
    };

    render() {
        const { error } = this.state;

        if (error) {
            if (this.props.fallback) {
                return this.props.fallback({ error, reset: this.reset });
            }
            return <DefaultErrorFallback error={error} reset={this.reset} />;
        }

        return this.props.children;
    }
}

const DefaultErrorFallback = ({ error, reset }: { error: Error; reset: () => void }) => (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <p className="text-sm text-red-400">{error.message || '알 수 없는 오류가 발생했습니다.'}</p>
        <button
            type="button"
            onClick={reset}
            className="px-4 py-2 text-sm rounded-md bg-stone-700 hover:bg-stone-600 text-stone-100 transition-colors"
        >
            다시 시도
        </button>
    </div>
);

export const ViewErrorBoundary = ({ children }: { children: ReactNode }) => (
    <QueryErrorResetBoundary>
        {({ reset }) => <ErrorBoundary onReset={reset}>{children}</ErrorBoundary>}
    </QueryErrorResetBoundary>
);
