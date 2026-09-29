import * as Crypto from 'expo-crypto'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { Storage } from '@lib/enums/Storage'
import { createMMKVStorage } from '@lib/storage/MMKV'

import { Workspace, WorkspaceCreateInput } from './types'

const DEFAULT_IMAGE = 'alpine:3.21'

const makeRuntimeName = (id: string) =>
    'agentws-' + id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)

const makeWorkspace = (input: WorkspaceCreateInput): Workspace => {
    const id = Crypto.randomUUID()
    const now = Date.now()

    return {
        id,
        name: input.name.trim() || 'Workspace',
        description: input.description?.trim() ?? '',
        instructions: input.instructions?.trim() ?? '',
        createdAt: now,
        updatedAt: now,
        accessProfile: input.accessProfile ?? 'full_access',
        runtime: {
            backend: 'termux-proot',
            containerName: makeRuntimeName(id),
            image: input.image?.trim() || DEFAULT_IMAGE,
        },
    }
}

type WorkspaceState = {
    workspaces: Workspace[]
    activeWorkspaceId?: string
    createWorkspace: (input: WorkspaceCreateInput) => Workspace
    updateWorkspace: (id: string, patch: Partial<Omit<Workspace, 'id' | 'createdAt'>>) => void
    removeWorkspaceMetadata: (id: string) => void
    setActiveWorkspace: (id?: string) => void
    getWorkspace: (id: string) => Workspace | undefined
    getActiveWorkspace: () => Workspace | undefined
}

export namespace Workspaces {
    export const useWorkspaceStore = create<WorkspaceState>()(
        persist(
            (set, get) => ({
                workspaces: [],
                activeWorkspaceId: undefined,

                createWorkspace: (input) => {
                    const workspace = makeWorkspace(input)
                    set((state) => ({
                        workspaces: [workspace, ...state.workspaces],
                        activeWorkspaceId: state.activeWorkspaceId ?? workspace.id,
                    }))
                    return workspace
                },

                updateWorkspace: (id, patch) => {
                    set((state) => ({
                        workspaces: state.workspaces.map((workspace) =>
                            workspace.id === id
                                ? {
                                      ...workspace,
                                      ...patch,
                                      id: workspace.id,
                                      createdAt: workspace.createdAt,
                                      updatedAt: Date.now(),
                                  }
                                : workspace
                        ),
                    }))
                },

                removeWorkspaceMetadata: (id) => {
                    set((state) => {
                        const next = state.workspaces.filter((workspace) => workspace.id !== id)
                        return {
                            workspaces: next,
                            activeWorkspaceId:
                                state.activeWorkspaceId === id
                                    ? next[0]?.id
                                    : state.activeWorkspaceId,
                        }
                    })
                },

                setActiveWorkspace: (id) => {
                    if (id && !get().workspaces.some((workspace) => workspace.id === id)) return
                    set({ activeWorkspaceId: id })
                },

                getWorkspace: (id) => get().workspaces.find((workspace) => workspace.id === id),

                getActiveWorkspace: () => {
                    const { workspaces, activeWorkspaceId } = get()
                    return workspaces.find((workspace) => workspace.id === activeWorkspaceId)
                },
            }),
            {
                name: Storage.Workspaces,
                storage: createMMKVStorage(),
                version: 1,
                partialize: (state) => ({
                    workspaces: state.workspaces,
                    activeWorkspaceId: state.activeWorkspaceId,
                }),
            }
        )
    )
}
