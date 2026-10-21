import { parsePhysicalProject, PHYSICAL_META_KEY } from "./backbone-physical.js";
import type { ProjectV1 } from "@spaghettilab/domain";
import type { GetStatusResponse } from "@spaghettilab/protocol-sdk";

export type TopologyBoard = { nodeId: number; local: boolean };
export type TopologyCheckpoint = { boards: TopologyBoard[]; pending: boolean; accepted?: string };
export const TOPOLOGY_META = "__backboneTopology";
export function topologyBoards(status?: GetStatusResponse): TopologyBoard[] {
  if (!status) return [];
  const peers = (status.chainPeers ?? []).filter(peer => !(peer.flags & 2));
  const local = peers.find(peer => peer.local);
  const id = status.deviceId;
  const nodeId = local?.nodeId ?? (id && id.length >= 6 ? (id[3]! << 16) | (id[4]! << 8) | id[5]! : undefined);
  return [...(nodeId === undefined ? [] : [{ nodeId, local: true }]), ...peers.filter(peer => !peer.local).map(peer => ({nodeId: peer.nodeId, local: false}))];
}
export const topologySignature = (boards: readonly TopologyBoard[]) => boards.map(board => `${board.local ? "usb" : "can"}:${board.nodeId}`).join("|");
export function topologyCheckpoints(project: ProjectV1): Record<string, TopologyCheckpoint> {
  try { return JSON.parse(project.authoringMetadata[TOPOLOGY_META]?.comment ?? "{}"); } catch { return {}; }
}
export function topologyNeedsReconfiguration(project: ProjectV1, bindingId: string, status?: GetStatusResponse): boolean {
  const checkpoint = topologyCheckpoints(project)[bindingId];
  if (!checkpoint) return false;
  const boards = topologyBoards(status);
  return checkpoint.pending || (boards.length > 0 && topologySignature(boards) !== topologySignature(checkpoint.boards));
}
export function topologyReviewAccepted(project: ProjectV1, bindingId: string, status?: GetStatusResponse): boolean {
  const checkpoint = topologyCheckpoints(project)[bindingId];
  return !!checkpoint?.accepted && checkpoint.accepted === topologySignature(topologyBoards(status));
}
export function withTopologyCheckpoint(project: ProjectV1, bindingId: string, checkpoint: TopologyCheckpoint): ProjectV1 {
  return {...project, authoringMetadata: {...project.authoringMetadata, [TOPOLOGY_META]: {comment: JSON.stringify({...topologyCheckpoints(project), [bindingId]: checkpoint})}}};
}

/** Seed old projects from their authored board identities before trusting live indices. */
export function initialTopologyCheckpoint(project: ProjectV1, bindingId: string, boards: TopologyBoard[]): TopologyCheckpoint {
  const expected = boards.map(board => ({...board}));
  const binding = project.coreBindings.find(item => item.bindingId === bindingId);
  const identity = binding?.expectedDeviceId?.replace(/[^0-9a-f]/gi, "");
  if (identity && identity.length >= 12 && expected[0]) expected[0] = {nodeId:Number.parseInt(identity.slice(6,12),16),local:true};
  const drafts=Object.entries(parsePhysicalProject(project.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts).filter(([key])=>key.startsWith(`${bindingId}:`));
  const primary=drafts.find(([,draft])=>draft.local!==false);
  const ordered=[primary,...drafts.filter(entry=>entry!==primary)];
  ordered.forEach((entry,index)=>{
    if(!entry || !entry[1].nodeId)return;
    const slot=entry[1].logicalSlot ? entry[1].logicalSlot!-1 : index;
    expected[slot]={nodeId:entry[1].nodeId!,local:slot===0};
  });
  // Unknown/unconfigured positions inherit the observed identity.
  const complete=Array.from({length:Math.max(expected.length,boards.length)},(_,i)=>expected[i] ?? boards[i]).filter((board):board is TopologyBoard=>!!board);
  return {boards:complete,pending:topologySignature(complete)!==topologySignature(boards)};
}
