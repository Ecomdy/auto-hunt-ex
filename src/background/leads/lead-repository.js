import { localLeadRepository } from './local-lead-repository.js';
import { remoteLeadRepository } from './remote-lead-repository.js';

// Factory — chọn nơi lưu lead theo setting "huntexLeadStorageMode" (Options page).
// Mặc định 'local' vì backend chưa sẵn sàng. Đổi setting là swap được, không sửa code gọi.
export async function getLeadRepository() {
  const { huntexLeadStorageMode } = await chrome.storage.sync.get('huntexLeadStorageMode');
  return huntexLeadStorageMode === 'remote' ? remoteLeadRepository : localLeadRepository;
}
