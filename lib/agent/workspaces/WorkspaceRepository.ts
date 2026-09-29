import { desc, eq } from 'drizzle-orm'
import * as Crypto from 'expo-crypto'

import { db as database } from '@db/db'
import { workspaceRuntimes, workspaces } from '@db/schema'

import { Workspace, WorkspaceCreateInput, WorkspaceRuntimeState } from './types'

const DEFAULT_DISTRO = 'debian'
const RUNTIME_VERSION = '1'

const selectWorkspace = {
    id: workspaces.id,
    name: workspaces.name,
    description: workspaces.description,
    instructions: workspaces.instructions,
    accessProfile: workspaces.access_profile,
    createdAt: workspaces.created_at,
    updatedAt: workspaces.updated_at,
    backend: workspaceRuntimes.backend,
    distroId: workspaceRuntimes.distro_id,
    runtimeVersion: workspaceRuntimes.runtime_version,
    rootfsVersion: workspaceRuntimes.rootfs_version,
    runtimeState: workspaceRuntimes.state,
    lastError: workspaceRuntimes.last_error,
}

type WorkspaceRow = {
    id: string
    name: string
    description: string
    instructions: string
    accessProfile: 'planning' | 'read_only' | 'full_access'
    createdAt: number
    updatedAt: number
    backend: 'embedded-proot'
    distroId: string
    runtimeVersion: string
    rootfsVersion: string
    runtimeState: WorkspaceRuntimeState
    lastError: string
}

export const workspaceFromRow = (row: WorkspaceRow): Workspace => ({
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    accessProfile: row.accessProfile,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    runtime: {
        backend: row.backend,
        distroId: row.distroId,
        runtimeVersion: row.runtimeVersion,
        rootfsVersion: row.rootfsVersion,
        state: row.runtimeState,
        lastError: row.lastError,
    },
})

export namespace WorkspaceRepository {
    export namespace live {
        export const list = () =>
            database
                .select(selectWorkspace)
                .from(workspaces)
                .innerJoin(
                    workspaceRuntimes,
                    eq(workspaceRuntimes.workspace_id, workspaces.id)
                )
                .where(eq(workspaces.archived, false))
                .orderBy(desc(workspaces.updated_at))
    }

    export namespace query {
        export const byId = async (id: string): Promise<Workspace | undefined> => {
            const [row] = await database
                .select(selectWorkspace)
                .from(workspaces)
                .innerJoin(
                    workspaceRuntimes,
                    eq(workspaceRuntimes.workspace_id, workspaces.id)
                )
                .where(eq(workspaces.id, id))
                .limit(1)

            return row ? workspaceFromRow(row as WorkspaceRow) : undefined
        }
    }

    export namespace mutate {
        export const create = async (input: WorkspaceCreateInput): Promise<Workspace> => {
            const id = Crypto.randomUUID()
            const now = Date.now()
            const workspaceValues = {
                id,
                name: input.name.trim() || 'Workspace',
                description: input.description?.trim() ?? '',
                instructions: input.instructions?.trim() ?? '',
                access_profile: input.accessProfile ?? 'full_access',
                archived: false,
                created_at: now,
                updated_at: now,
            } as const

            const runtimeValues = {
                workspace_id: id,
                backend: 'embedded-proot',
                distro_id: input.distroId?.trim() || DEFAULT_DISTRO,
                runtime_version: RUNTIME_VERSION,
                rootfs_version: '',
                state: 'not_installed',
                last_error: '',
            } as const

            await database.transaction(async (tx) => {
                await tx.insert(workspaces).values(workspaceValues)
                await tx.insert(workspaceRuntimes).values(runtimeValues)
            })

            return {
                id,
                name: workspaceValues.name,
                description: workspaceValues.description,
                instructions: workspaceValues.instructions,
                accessProfile: workspaceValues.access_profile,
                createdAt: now,
                updatedAt: now,
                runtime: {
                    backend: 'embedded-proot',
                    distroId: runtimeValues.distro_id,
                    runtimeVersion: RUNTIME_VERSION,
                    rootfsVersion: '',
                    state: 'not_installed',
                    lastError: '',
                },
            }
        }

        export const updateInfo = async (
            id: string,
            patch: Partial<
                Pick<Workspace, 'name' | 'description' | 'instructions' | 'accessProfile'>
            >
        ) => {
            const values: Partial<typeof workspaces.$inferInsert> = {
                updated_at: Date.now(),
            }
            if (patch.name !== undefined) values.name = patch.name.trim() || 'Workspace'
            if (patch.description !== undefined) values.description = patch.description.trim()
            if (patch.instructions !== undefined) values.instructions = patch.instructions.trim()
            if (patch.accessProfile !== undefined) values.access_profile = patch.accessProfile

            await database.update(workspaces).set(values).where(eq(workspaces.id, id))
        }

        export const setRuntimeState = async (
            workspaceId: string,
            state: WorkspaceRuntimeState,
            options: { rootfsVersion?: string; lastError?: string } = {}
        ) => {
            await database
                .update(workspaceRuntimes)
                .set({
                    state,
                    rootfs_version: options.rootfsVersion,
                    last_error: options.lastError ?? '',
                    installed_at: state === 'ready' ? Date.now() : undefined,
                    last_used_at: Date.now(),
                })
                .where(eq(workspaceRuntimes.workspace_id, workspaceId))
        }

        export const archive = async (id: string) => {
            await database
                .update(workspaces)
                .set({ archived: true, updated_at: Date.now() })
                .where(eq(workspaces.id, id))
        }

        export const remove = async (id: string) => {
            await database.delete(workspaces).where(eq(workspaces.id, id))
        }
    }
}
