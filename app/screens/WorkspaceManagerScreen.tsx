import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import ThemedButton from '@components/buttons/ThemedButton'
import ThemedTextInput from '@components/input/ThemedTextInput'
import HeaderTitle from '@components/views/HeaderTitle'
import { WorkspaceService } from '@lib/agent/workspaces/WorkspaceService'
import { Workspaces } from '@lib/agent/workspaces/WorkspaceStore'
import { Workspace } from '@lib/agent/workspaces/types'
import { Theme } from '@lib/theme/ThemeManager'

const DEFAULT_IMAGE = 'alpine:3.21'

const WorkspaceManagerScreen = () => {
    const { spacing } = Theme.useTheme()
    const workspaces = Workspaces.useWorkspaceStore((state) => state.workspaces)
    const activeWorkspaceId = Workspaces.useWorkspaceStore((state) => state.activeWorkspaceId)
    const createWorkspace = Workspaces.useWorkspaceStore((state) => state.createWorkspace)
    const setActiveWorkspace = Workspaces.useWorkspaceStore((state) => state.setActiveWorkspace)

    const [name, setName] = useState('')
    const [image, setImage] = useState(DEFAULT_IMAGE)
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
            setOutput(
                workspace.id,
                error instanceof Error ? error.message : String(error)
            )
        } finally {
            setBusy(undefined)
        }
    }

    const handleCreate = () => {
        const workspace = createWorkspace({
            name: name.trim() || 'Workspace ' + (workspaces.length + 1),
            image: image.trim() || DEFAULT_IMAGE,
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
                        Each workspace gets durable project files and its own named Linux
                        environment. The project directory is mounted at /workspace and is kept
                        separate from the Linux rootfs so the computer can be rebuilt without
                        throwing away the project.
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
                        value={image}
                        onChangeText={setImage}
                        placeholder="OCI image, e.g. alpine:3.21"
                    />
                    <ThemedButton label="Create workspace" onPress={handleCreate} />
                </View>

                {workspaces.length === 0 && (
                    <View style={styles.emptyCard}>
                        <Text style={styles.secondary}>
                            No workspaces yet. Creating one only saves its definition; the Linux
                            computer is provisioned when you ask for it.
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
                                    <Text style={styles.mono}>
                                        {workspace.runtime.containerName}
                                    </Text>
                                </View>
                                <Text style={active ? styles.activeText : styles.secondary}>
                                    {active ? 'ACTIVE' : 'IDLE'}
                                </Text>
                            </View>

                            <View style={styles.metadata}>
                                <Text style={styles.secondary}>
                                    Backend: Termux + PRoot-Distro
                                </Text>
                                <Text style={styles.secondary}>
                                    Image: {workspace.runtime.image}
                                </Text>
                                <Text style={styles.secondary}>
                                    Access: {workspace.accessProfile}
                                </Text>
                            </View>

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
                                    label="Check host"
                                    disabled={isBusy}
                                    onPress={() =>
                                        run(workspace, 'probe', () =>
                                            WorkspaceService.probe(workspace)
                                        )
                                    }
                                />
                                <ThemedButton
                                    variant="secondary"
                                    label="Prepare host"
                                    disabled={isBusy}
                                    onPress={() =>
                                        run(workspace, 'prepare', () =>
                                            WorkspaceService.prepareHost(workspace)
                                        )
                                    }
                                />
                                <ThemedButton
                                    label="Provision computer"
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
                                    disabled={isBusy}
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
