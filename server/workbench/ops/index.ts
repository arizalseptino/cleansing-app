import type { OperationDefinition } from '../types'
import addColumn from './add_column'
import conditionalRule from './conditional_rule'
import deduplicate from './deduplicate'
import extractAndRoute from './extract_and_route'
import fillFromMaster from './fill_from_master'
import replaceValues from './replace_values'
import trimText from './trim_text'

export const operations: Record<string, OperationDefinition> = {
  trim_text: trimText,
  replace_values: replaceValues,
  add_column: addColumn,
  fill_from_master: fillFromMaster,
  deduplicate,
  conditional_rule: conditionalRule,
  extract_and_route: extractAndRoute,
}

export function listWorkbenchOperations() {
  return Object.values(operations).map(({ validate: _validate, compile: _compile, ...definition }) => definition)
}
