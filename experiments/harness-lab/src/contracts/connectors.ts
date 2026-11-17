/** R4 wire contracts contain no SDK/Pi types or recoverable credential values. */
export type ConnectorKind = 'mcp' | 'legacy';
export type ConnectorBusinessSlot = 'information' | 'situation' | 'simulation-control' | 'ingress';
export interface ConnectorPolicy { mode: 'none' | 'all' | 'seats'; seatIds: string[]; personal: boolean }
export interface ConnectorAuth { mode: 'none' | 'bearer' | 'api-key'; credentialSource: 'organization' | 'personal'; headerName?: string }
export interface ConnectorTool { name: string; description?: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown>; annotations?: Record<string, unknown>; available: boolean; unavailableReason?: string; contractDigest: string }
export interface ConnectorExposure { name: string; contractDigest: string }
export interface ConnectorConfigInput { name: string; description: string; endpoint: string; auth: ConnectorAuth; approvedTargets: string[]; policy: ConnectorPolicy; exposedTools: ConnectorExposure[] }
export interface ConnectorRevision extends ConnectorConfigInput { connectorId: string; revisionId: string; revision: number; kind: ConnectorKind; businessSlot?: ConnectorBusinessSlot; createdAt: string }
export interface ConnectorCredentialStatus { configured: boolean; version: number; source: 'organization' | 'personal' | 'environment' | 'none' }
export interface ConnectorSummary { connectorId: string; revisionId: string; revision: number; kind: ConnectorKind; name: string; description: string; businessSlot?: ConnectorBusinessSlot; state: 'enabled' | 'disabled'; stateRevision: number; auth: ConnectorAuth; credential: ConnectorCredentialStatus; tools: ConnectorTool[] }
export interface ConnectorAudit { id: string; connectorId: string; userId: string; action: string; createdAt: string; detail: Record<string, unknown> }
export interface ConnectorDetail { connection: ConnectorSummary; revision: ConnectorRevision; revisions: ConnectorRevision[]; audit: ConnectorAudit[]; sourceIds?: string[]; discovery?: ConnectorDiscovery }
export interface ConnectorDiscovery { protocolVersion: string; protocolEra: string; serverInfo?: Record<string, unknown>; tools: ConnectorTool[]; digest: string; discoveredAt?: string }
export interface CreateConnectorInput extends ConnectorConfigInput { clientActionId: string }
export interface UpdateConnectorInput extends ConnectorConfigInput { expectedRevisionId: string; clientActionId: string }
export interface ConnectorLifecycleInput { action: 'disable' | 'restore'; expectedStateRevision: number; clientActionId: string }
export interface ConnectorCredentialInput { value: string; expectedVersion: number; clientActionId: string }
export interface RevokeConnectorCredentialInput { expectedVersion: number; clientActionId: string }
export interface ConnectorSelection { connectorId: string; revisionId: string }
/** Explicit reference only; legacy experts omit this field and acquire no MCP tools. */
export interface ConnectorRequirement { connectorId: string; actions: ConnectorExposure[] }
export interface ConnectorCallSummary { schemaVersion: 1; connectorId: string; revisionId: string; connectorName: string; action: string; contractDigest: string; subjectId: string; credentialVersion: number; argumentsDigest: string }
export interface ConnectorCallIntent extends ConnectorCallSummary { intentId: string; requestId: string; userId: string; state: 'prepared' | 'sent' | 'completed' | 'unknown' | 'cancelled'; createdAt: string; completedAt?: string }
/** Server-only identities are derived from the current authenticated account. */
export interface ConnectorPrincipal { userId: string; seatId?: string; workspaceKind?: 'personal' | 'task'; assertActive: () => void }
export interface ConnectorActor extends ConnectorPrincipal { assertAdministrator: () => void }
export interface ConnectorAdmission { revision: ConnectorRevision; subjectId: string; credentialVersion: number; headers: Record<string, string>; admittedAt: string }
