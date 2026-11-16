import { listWorkbenchOperations } from '../../workbench/ops'

export default defineEventHandler(async () => {
  return {
    data: listWorkbenchOperations(),
  }
})
