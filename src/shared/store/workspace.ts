import { create } from 'zustand';

interface WorkspaceState {
    workspaceName: string;
    setWorkspaceName: (name: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
    workspaceName: '',
    setWorkspaceName: (name) => set({ workspaceName: name }),
}));
