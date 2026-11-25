export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'user';
}

export interface AssetRow {
  id: string;
  user_id: number;
  asset_id: string;
  original_filename: string;
  captured_at: string;
  media_type: 'photo' | 'video';
  mime_type: string;
  size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  relative_path: string;
  created_at: string;
}

export interface UploadRow {
  id: string;
  user_id: number;
  asset_id: string;
  original_filename: string;
  captured_at: string;
  media_type: 'photo' | 'video';
  mime_type: string;
  expected_size: number;
  expected_sha256: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  total_chunks: number;
  status: 'pending' | 'assembling' | 'completed' | 'failed';
  asset_record_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
