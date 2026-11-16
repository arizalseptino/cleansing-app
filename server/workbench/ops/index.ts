import type { OperationDefinition } from '../types'
import addColumn from './add_column'
import fillFromMaster from './fill_from_master'
import replaceValues from './replace_values'
import trimText from './trim_text'

export const operations: Record<string, OperationDefinition> = {
  trim_text: trimText,
  replace_values: replaceValues,
  add_column: addColumn,
  fill_from_master: fillFromMaster,
}

export function listWorkbenchOperations() {
  return Object.values(operations).map(({ validate: _validate, compile: _compile, ...definition }) => definition)
}
