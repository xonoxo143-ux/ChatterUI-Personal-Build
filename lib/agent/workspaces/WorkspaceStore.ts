import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { Storage } from '@lib/enums/Storage'
import { createMMKVStorage } from '@lib/storage/MMKV'

type WorkspaceSelectionState = {
    activeWorkspaceId?: string
    setActiveWorkspace: (id?: string) => void
}

export namespace Workspaces {
    /**
     * Only UI selection lives in MMKV.
     *
     * Workspace identity, runtime metadata, permissions and links are durable SQLite data.
     * Keeping the active selection here is equivalent to remembering the last-opened tab.
     */
    export const useWorkspaceStore = create<WorkspaceSelectionState>()(
        persist(
            (set) => ({
                activeWorkspaceId: undefined,
                setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
            }),
            {
                name: Storage.Workspaces,
                storage: createMMKVStorage(),
                version: 2,
                partialize: (state) => ({
                    activeWorkspaceId: state.activeWorkspaceId,
                }),
            }
        )
    )
}
