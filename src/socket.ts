import { Server } from 'socket.io';

let _io: Server | null = null;

export function setIo(io: Server) { _io = io; }
export function getIo(): Server | null { return _io; }

export function emitDbChange(table: string, event: 'INSERT' | 'UPDATE' | 'DELETE', row: any, oldRow?: any) {
  if (!_io) return;
  _io.emit('db-change', { table, event, new: row, old: oldRow ?? null });
}
