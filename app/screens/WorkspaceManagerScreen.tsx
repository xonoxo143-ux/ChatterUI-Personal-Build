import { useLiveQuery } from 'drizzle-orm/expo-sqlite'
import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import ThemedButton from '@components/buttons/ThemedButton'
import ThemedTextInput from '@components/input/ThemedTextInput'
import HeaderTitle from '@components/views/HeaderTitle'
import { WorkspaceRepository, workspaceFromRow } from '@lib/agent/workspaces/WorkspaceRepository'
import { WorkspaceService } from '@lib/agent/workspaces/WorkspaceService'
import { Workspaces } from '@lib/agent/workspaces/WorkspaceStore'
import { Workspace } from '@lib/agent/workspaces/types'
import { Theme } from '@lib/theme/ThemeManager'

const DEFAULT_DISTRO = 'debian'

const WorkspaceManagerScreen = () => {
    const { spacing } = Theme.useTheme()
    const { data: rows = [] } = useLiveQuery(WorkspaceRepository.live.list())
    const workspaces = rows.map(workspaceFromRow)

    const activeWorkspaceId = Workspaces.useWorkspaceStore((state) => state.activeWorkspaceId)
    const setActiveWorkspace = Workspaces.useWorkspaceStore((state) => state.setActiveWorkspace)

    const [name, setName] = useState('')
    const [distroId, setDistroId] = useState(DEFAULT_DISTRO)
    const [busy, setBusy] = useState<string>()
    const [outputs, setOutputs] = useState<Record<string, string>>({})

    const styles = useStyles()

    const setOutput = (workspaceId: string, output: string) => {
        setOutputs((state) => ({ ...state, [workspaceId]: output.trim() }))
    }

    const run = async (
        workspace: Workspace,
        action: string,
        operation: () => Promise<unknown>
    ) => {
        const key = workspace.id + ':' + action
        setBusy(key)
        try {
            const result = await operation()
            setOutput(workspace.id, JSON.stringify(result, null, 2).slice(0, 6000))
        } catch (error) {
            setOutput(workspace.id, error instanceof Error ? error.message : String(error))
        } finally {
            setBusy(undefined)
        }
    }

    const handleCreate = async () => {
        const requestedDistro = distroId.trim().toLowerCase()
        if (requestedDistro !== 'debian' && requestedDistro !== 'alpine') {
            return
        }

        const workspace = await WorkspaceRepository.mutate.create({
            name: name.trim() || 'Workspace ' + (workspaces.length + 1),
            distroId: requestedDistro,
            accessProfile: 'full_access',
        })
        setActiveWorkspace(workspace.id)
        setName('')
    }

    return (
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
            <HeaderTitle title="Workspaces" />
            <ScrollView
                contentContainerStyle={{ rowGap: spacing.xl, paddingBottom: spacing.xl2 }}
                showsVerticalScrollIndicator={false}>
                <View style={styles.intro}>
                    <Text style={styles.title}>Workspace Computers</Text>
                    <Text style={styles.secondary}>
                        A workspace keeps your project and its own Linux computer together. Linux
                        runs inside this app; there is no separate Termux installation.
                    </Text>
                </View>

                <View style={styles.createCard}>
                    <Text style={styles.sectionTitle}>New workspace</Text>
                    <ThemedTextInput
                        value={name}
                        onChangeText={setName}
                        placeholder="Workspace name"
                    />
                    <ThemedTextInput
                        value={distroId}
                        onChangeText={setDistroId}
                        placeholder="debian or alpine"
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                    <ThemedButton label="Create workspace" onPress={handleCreate} />
                </View>

                {workspaces.length === 0 && (
                    <View style={styles.emptyCard}>
                        <Text style={styles.secondary}>
                            No workspaces yet. Creating one saves the project definition first.
                            Linux downloads only when you choose Install Linux.
                        </Text>
                    </View>
                )}

                {workspaces.map((workspace) => {
                    const active = workspace.id === activeWorkspaceId
                    const prefix = workspace.id + ':'
                    const isBusy = busy?.startsWith(prefix) ?? false

                    return (
                        <View
                            key={workspace.id}
                            style={[styles.workspaceCard, active && styles.activeCard]}>
                            <View style={styles.rowBetween}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.workspaceName}>{workspace.name}</Text>
                                    <Text style={styles.mono}>{workspace.id.slice(0, 12)}</Text>
                                </View>
                                <Text style={active ? styles.activeText : styles.secondary}>
                                    {active ? 'ACTIVE' : 'IDLE'}
                                </Text>
                            </View>

                            <View style={styles.metadata}>
                                <Text style={styles.secondary}>Runtime: Built-in Linux</Text>
                                <Text style={styles.secondary}>
                                    Linux: {workspace.runtime.distroId}
                                </Text>
                                <Text style={styles.secondary}>
                                    State: {workspace.runtime.state}
                                </Text>
                                <Text style={styles.secondary}>
                                    Access: {workspace.accessProfile}
                                </Text>
                            </View>

                            {!!workspace.runtime.lastError && (
                                <Text style={styles.errorText}>{workspace.runtime.lastError}</Text>
                            )}

                            <View style={styles.buttonRow}>
                                {!active && (
                                    <ThemedButton
                                        variant="secondary"
                                        label="Make active"
                                        onPress={() => setActiveWorkspace(workspace.id)}
                                    />
                                )}
                                <ThemedButton
                                    variant="secondary"
                                    label="Check runtime"
                                    disabled={isBusy}
                                    onPress={() =>
                                        run(workspace, 'probe', () =>
                                            WorkspaceService.probe(workspace)
                                        )
                                    }
                                />
                                <ThemedButton
                                    label="Install Linux"
                                    disabled={isBusy}
                                    onPress={() =>
                                        run(workspace, 'provision', () =>
                                            WorkspaceService.provision(workspace)
                                        )
                                    }
                                />
                                <ThemedButton
                                    variant="secondary"
                                    label="Status"
                                    disabled={isBusy}
                                    onPress={() =>
                                        run(workspace, 'status', () =>
                                            WorkspaceService.status(workspace)
                                        )
                                    }
                                />
                                <ThemedButton
                                    variant="secondary"
                                    label="Test shell"
                                    disabled={isBusy || workspace.runtime.state !== 'ready'}
                                    onPress={() =>
                                        run(workspace, 'shell', () =>
                                            WorkspaceService.exec(workspace, {
                                                command:
                                                    'printf "hello from %s\\n" "$AGENT_WORKSPACE_NAME"; pwd; uname -m',
                                                timeoutSeconds: 30,
                                            })
                                        )
                                    }
                                />
                            </View>

                            {isBusy && <Text style={styles.secondary}>Working…</Text>}

                            {!!outputs[workspace.id] && (
                                <Text selectable style={styles.output}>
                                    {outputs[workspace.id]}
                                </Text>
                            )}
                        </View>
                    )
                })}
            </ScrollView>
        </SafeAreaView>
    )
}

const useStyles = () => {
    const { color, spacing, borderRadius, borderWidth, fontSize } = Theme.useTheme()

    return StyleSheet.create({
        safeArea: {
            flex: 1,
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.xl,
        },
        intro: {
            rowGap: spacing.m,
        },
        title: {
            color: color.text._100,
            fontSize: fontSize.xl,
            fontWeight: '600',
        },
        sectionTitle: {
            color: color.text._100,
            fontSize: fontSize.l,
            fontWeight: '600',
        },
        secondary: {
            color: color.text._400,
        },
        errorText: {
            color: color.error._400,
        },
        createCard: {
            rowGap: spacing.l,
            padding: spacing.xl,
            borderRadius: borderRadius.l,
            borderWidth: borderWidth.m,
            borderColor: color.neutral._400,
            backgroundColor: color.neutral._200,
        },
        emptyCard: {
            padding: spacing.xl,
            borderRadius: borderRadius.l,
            backgroundColor: color.neutral._200,
        },
        workspaceCard: {
            rowGap: spacing.l,
            padding: spacing.xl,
            borderRadius: borderRadius.l,
            borderWidth: borderWidth.m,
            borderColor: color.neutral._400,
            backgroundColor: color.neutral._200,
        },
        activeCard: {
            borderColor: color.primary._500,
        },
        rowBetween: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            columnGap: spacing.l,
        },
        workspaceName: {
            color: color.text._100,
            fontSize: fontSize.xl,
            fontWeight: '600',
        },
        activeText: {
            color: color.primary._500,
            fontWeight: '700',
        },
        mono: {
            color: color.text._500,
            fontFamily: 'monospace',
            marginTop: spacing.s,
        },
        metadata: {
            rowGap: spacing.s,
        },
        buttonRow: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: spacing.m,
        },
        output: {
            color: color.text._300,
            backgroundColor: color.neutral._100,
            borderRadius: borderRadius.m,
            padding: spacing.l,
            fontFamily: 'monospace',
            fontSize: fontSize.s,
        },
    })
}

export default WorkspaceManagerScreen
