import { listCleansingFeatures } from '../../features'

export default defineEventHandler(() => ({
  data: listCleansingFeatures(),
}))
