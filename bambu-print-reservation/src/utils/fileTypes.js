'use strict';

/**
 * 切片产物口径（唯一权威定义，v56 合一防漂移——此前 reservation.js 与 dispatcher.js
 * 各维护一份正则，2026-10-14 双品牌批扩时曾靠人肉同步）：
 *   切片产物 = 拓竹 3mf + 闪铸 gcode 系（gcode/gx/g）
 *   未切片模型 = stl/step/stp/obj（需求链路单，不能直接驱动真机）
 */
const SLICED_EXT_RE = /\.(3mf|gcode|gx|g)$/i;

function isSlicedFileName(fileName) {
  return SLICED_EXT_RE.test(String(fileName || ''));
}

function isUnslicedFileName(fileName) {
  return !isSlicedFileName(fileName);
}

module.exports = { SLICED_EXT_RE, isSlicedFileName, isUnslicedFileName };
