"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setIo = setIo;
exports.getIo = getIo;
exports.emitDbChange = emitDbChange;
let _io = null;
function setIo(io) { _io = io; }
function getIo() { return _io; }
function emitDbChange(table, event, row, oldRow) {
    if (!_io)
        return;
    _io.emit('db-change', { table, event, new: row, old: oldRow ?? null });
}
