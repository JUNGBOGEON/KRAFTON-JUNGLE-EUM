const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface AuthResponse {
  user: {
    id: number;
    email: string;
    nickname: string;
    profile_img?: string;
    provider?: string;
  };
  expires_in: number;
}

interface UserSearchResult {
  id: number;
  email: string;
  nickname: string;
  profile_img?: string;
}

interface SearchUsersResponse {
  users: UserSearchResult[];
  total: number;
}

// 워크스페이스 관련 타입
interface WorkspaceMember {
  id: number;
  user_id: number;
  role_id?: number;
  status: 'PENDING' | 'ACTIVE'; // Required field with union type
  joined_at: string;
  user?: UserSearchResult;
  role?: {
    id: number;
    name: string;
    color?: string;
    is_default: boolean;
    permissions: string[];
  };
}

interface Workspace {
  id: number;
  name: string;
  owner_id: number;
  created_at: string;
  owner?: UserSearchResult;
  members?: WorkspaceMember[];
}

interface WorkspacesResponse {
  workspaces: Workspace[];
  total: number;
}

interface CreateWorkspaceRequest {
  name: string;
  member_ids?: number[];
}

interface Role {
  id: number;
  workspace_id: number;
  name: string;
  color?: string;
  is_default: boolean;
  permissions?: { permission_code: string }[];
}

// 채팅 관련 타입
interface ChatMessage {
  id: number;
  meeting_id: number;
  sender_id?: number;
  message: string;
  type: string;
  created_at: string;
  sender?: UserSearchResult;
}

interface ChatsResponse {
  meeting_id: number;
  messages: ChatMessage[];
  total: number;
}

// 채팅방 관련 타입
interface ChatRoom {
  id: number;
  workspace_id: number;
  title: string;
  created_at: string;
  message_count: number;
}

interface ChatRoomsResponse {
  rooms: ChatRoom[];
  total: number;
}

interface ChatRoomMessagesResponse {
  room_id: number;
  messages: ChatMessage[];
  total: number;
}

// 미팅 관련 타입
interface Participant {
  id: number;
  user_id?: number;
  role: string;
  joined_at: string;
  left_at?: string;
  user?: UserSearchResult;
}

interface Meeting {
  id: number;
  workspace_id?: number;
  host_id: number;
  title: string;
  code: string;
  type: string;
  status: string;
  started_at?: string;
  ended_at?: string;
  host?: UserSearchResult;
  participants?: Participant[];
}

interface MeetingsResponse {
  meetings: Meeting[];
  total: number;
}

interface CreateMeetingRequest {
  title: string;
  type?: string;
}

// 캘린더 관련 타입
interface EventAttendee {
  user_id: number;
  status: string;
  created_at: string;
  user?: UserSearchResult;
}

interface CalendarEvent {
  id: number;
  workspace_id: number;
  creator_id?: number;
  title: string;
  description?: string;
  start_at: string;
  end_at: string;
  is_all_day: boolean;
  linked_meeting_id?: number;
  color?: string;
  created_at: string;
  creator?: UserSearchResult;
  attendees?: EventAttendee[];
}

interface EventsResponse {
  events: CalendarEvent[];
  total: number;
}

interface CreateEventRequest {
  title: string;
  description?: string;
  start_at: string;
  end_at: string;
  is_all_day?: boolean;
  color?: string;
  attendee_ids?: number[];
}

// 저장소 관련 타입
interface WorkspaceFile {
  id: number;
  workspace_id: number;
  uploader_id?: number;
  parent_folder_id?: number;
  name: string;
  type: string;
  file_url?: string;
  file_size?: number;
  mime_type?: string;
  related_meeting_id?: number;
  created_at: string;
  uploader?: UserSearchResult;
  children?: WorkspaceFile[];
}

interface FilesResponse {
  files: WorkspaceFile[];
  total: number;
  breadcrumbs?: WorkspaceFile[];
}

// 알림 관련 타입
interface Notification {
  id: number;
  user_id?: number;
  type: string;
  content: string;
  workspace_id?: number;
  sender_id?: number;
  is_read: boolean;
  related_type?: string;
  related_id?: number;
  created_at: string;
  sender?: UserSearchResult;
}

interface NotificationsResponse {
  notifications: Notification[];
  total: number;
}

// 화이트보드 관련 타입
interface WhiteboardResponse {
  success: boolean;
  history: unknown[];
  canUndo: boolean;
  canRedo: boolean;
}

// 음성 기록 관련 타입
interface VoiceRecord {
  id: number;
  meeting_id: number;
  speaker_id?: number;
  speaker_name: string;
  original: string;
  translated?: string;
  target_lang?: string;
  created_at: string;
  speaker?: UserSearchResult;
}

interface VoiceRecordsResponse {
  meeting_id: number;
  records: VoiceRecord[];
  total: number;
  limit: number;
  offset: number;
}

interface CreateVoiceRecordRequest {
  speaker_name: string;
  original: string;
  translated?: string;
  target_lang?: string;
}

interface CreateVoiceRecordBulkRequest {
  records: CreateVoiceRecordRequest[];
}

// HTTP-only 쿠키 기반 인증 (XSS 방지)
class ApiClient {
  private isLoggedIn: boolean = false;

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    skipAutoRefresh: boolean = false
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    // FormData인 경우 Content-Type 헤더 제거 (브라우저가 자동으로 boundary 설정)
    if (options.body instanceof FormData) {
      delete headers['Content-Type'];
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include', // 쿠키 자동 전송
    });

    if (response.status === 401) {
      // auth 엔드포인트는 자동 갱신 건너뛰기
      if (!skipAutoRefresh) {
        // 토큰 만료 시 갱신 시도
        const refreshed = await this.refreshToken();
        if (refreshed) {
          // 재시도
          const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers,
            credentials: 'include',
          });
          if (!retryResponse.ok) {
            throw new Error('Request failed after token refresh');
          }
          return retryResponse.json();
        }
      }
      this.isLoggedIn = false;
      throw new Error('Authentication required');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  async loginWithGoogle(idToken: string): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken }),
    });
    this.isLoggedIn = true;
    return response;
  }

  async refreshToken(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        this.isLoggedIn = false;
        return false;
      }

      this.isLoggedIn = true;
      return true;
    } catch {
      this.isLoggedIn = false;
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } finally {
      this.isLoggedIn = false;
    }
  }

  async getMe(): Promise<AuthResponse['user']> {
    return this.request<AuthResponse['user']>('/auth/me', {}, true);
  }

  // 서버에 인증 상태 확인 (쿠키 기반)
  async checkAuth(): Promise<boolean> {
    try {
      await this.getMe();
      this.isLoggedIn = true;
      return true;
    } catch {
      this.isLoggedIn = false;
      return false;
    }
  }

  // 프로필 수정
  async updateProfile(data: FormData | { nickname: string; profile_img?: string }): Promise<AuthResponse['user']> {
    let body: BodyInit;
    const headers: HeadersInit = {};

    if (data instanceof FormData) {
      body = data;
      // Content-Type header should be let empty for FormData to let the browser set it with boundary
    } else {
      body = JSON.stringify(data);
      headers['Content-Type'] = 'application/json';
    }

    return this.request<AuthResponse['user']>('/auth/me', {
      method: 'PUT',
      body,
      headers,
    });
  }

  // 유저 검색 (닉네임 또는 이메일)
  async searchUsers(query: string): Promise<SearchUsersResponse> {
    if (query.length < 2) {
      return { users: [], total: 0 };
    }
    return this.request<SearchUsersResponse>(
      `/api/users/search?q=${encodeURIComponent(query)}`
    );
  }

  // 워크스페이스 생성
  async createWorkspace(data: CreateWorkspaceRequest): Promise<Workspace> {
    return this.request<Workspace>('/api/workspaces/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // 내 워크스페이스 목록 조회
  async getMyWorkspaces(): Promise<WorkspacesResponse> {
    return this.request<WorkspacesResponse>('/api/workspaces/');
  }

  // 워크스페이스 상세 조회
  async getWorkspace(id: number): Promise<Workspace> {
    return this.request<Workspace>(`/api/workspaces/${id}`);
  }

  // 워크스페이스 멤버 추가
  async addWorkspaceMembers(workspaceId: number, memberIds: number[]): Promise<{ message: string; added_count: number }> {
    return this.request(`/api/workspaces/${workspaceId}/members`, {
      method: 'POST',
      body: JSON.stringify({ member_ids: memberIds }),
    });
  }

  // 워크스페이스 나가기
  async leaveWorkspace(workspaceId: number): Promise<{ message: string }> {
    return this.request(`/api/workspaces/${workspaceId}/leave`, {
      method: 'DELETE',
    });
  }

  // 워크스페이스 수정
  async updateWorkspace(workspaceId: number, name: string): Promise<Workspace> {
    return this.request<Workspace>(`/api/workspaces/${workspaceId}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  }

  // 워크스페이스 삭제
  async deleteWorkspace(workspaceId: number): Promise<void> {
    await this.request(`/api/workspaces/${workspaceId}`, {
      method: 'DELETE',
    });
  }

  // ========== 역할(Role) API ==========
  async getRoles(workspaceId: number): Promise<Role[]> {
    return this.request<Role[]>(`/api/workspaces/${workspaceId}/roles`);
  }

  async createRole(workspaceId: number, name: string, color?: string, permissions?: string[]): Promise<Role> {
    return this.request<Role>(`/api/workspaces/${workspaceId}/roles`, {
      method: "POST",
      body: JSON.stringify({ name, color, permissions }),
    });
  }

  async updateRole(workspaceId: number, roleId: number, name: string, color?: string, permissions?: string[]): Promise<Role> {
    return this.request<Role>(`/api/workspaces/${workspaceId}/roles/${roleId}`, {
      method: "PUT",
      body: JSON.stringify({ name, color, permissions }),
    });
  }

  async deleteRole(workspaceId: number, roleId: number): Promise<void> {
    await this.request(`/api/workspaces/${workspaceId}/roles/${roleId}`, {
      method: 'DELETE',
    });
  }

  async updateMemberRole(workspaceId: number, userId: number, roleId: number): Promise<void> {
    await this.request(`/api/workspaces/${workspaceId}/members/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role_id: roleId }),
    });
  }

  // ========== 채팅 API ==========
  async getWorkspaceChats(workspaceId: number, limit = 50, offset = 0): Promise<ChatsResponse> {
    return this.request<ChatsResponse>(
      `/api/workspaces/${workspaceId}/chats?limit=${limit}&offset=${offset}`
    );
  }

  async sendMessage(workspaceId: number, message: string, type = 'TEXT'): Promise<ChatMessage> {
    return this.request<ChatMessage>(`/api/workspaces/${workspaceId}/chats`, {
      method: 'POST',
      body: JSON.stringify({ message, type }),
    });
  }

  // ========== 채팅방 API (다중 채팅방) ==========
  async getChatRooms(workspaceId: number): Promise<ChatRoomsResponse> {
    return this.request<ChatRoomsResponse>(`/api/workspaces/${workspaceId}/chatrooms`);
  }

  async createChatRoom(workspaceId: number, title: string): Promise<ChatRoom> {
    return this.request<ChatRoom>(`/api/workspaces/${workspaceId}/chatrooms`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
  }

  async getChatRoomMessages(workspaceId: number, roomId: number, limit = 50, offset = 0): Promise<ChatRoomMessagesResponse> {
    return this.request<ChatRoomMessagesResponse>(
      `/api/workspaces/${workspaceId}/chatrooms/${roomId}/messages?limit=${limit}&offset=${offset}`
    );
  }

  async sendChatRoomMessage(workspaceId: number, roomId: number, message: string, type = 'TEXT'): Promise<ChatMessage> {
    return this.request<ChatMessage>(`/api/workspaces/${workspaceId}/chatrooms/${roomId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message, type }),
    });
  }

  async updateChatRoom(workspaceId: number, roomId: number, title: string): Promise<ChatRoom> {
    return this.request<ChatRoom>(`/api/workspaces/${workspaceId}/chatrooms/${roomId}`, {
      method: 'PUT',
      body: JSON.stringify({ title }),
    });
  }

  async deleteChatRoom(workspaceId: number, roomId: number): Promise<{ message: string }> {
    return this.request(`/api/workspaces/${workspaceId}/chatrooms/${roomId}`, {
      method: 'DELETE',
    });
  }

  // ========== 미팅 API ==========
  async getWorkspaceMeetings(workspaceId: number): Promise<MeetingsResponse> {
    return this.request<MeetingsResponse>(`/api/workspaces/${workspaceId}/meetings`);
  }

  async createMeeting(workspaceId: number, data: CreateMeetingRequest): Promise<Meeting> {
    return this.request<Meeting>(`/api/workspaces/${workspaceId}/meetings`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getMeeting(workspaceId: number, meetingId: number): Promise<Meeting> {
    return this.request<Meeting>(`/api/workspaces/${workspaceId}/meetings/${meetingId}`);
  }

  async startMeeting(workspaceId: number, meetingId: number): Promise<Meeting> {
    return this.request<Meeting>(`/api/workspaces/${workspaceId}/meetings/${meetingId}/start`, {
      method: 'POST',
    });
  }

  async endMeeting(workspaceId: number, meetingId: number): Promise<{ message: string }> {
    return this.request(`/api/workspaces/${workspaceId}/meetings/${meetingId}/end`, {
      method: 'POST',
    });
  }

  // ========== 캘린더 API ==========
  async getWorkspaceEvents(workspaceId: number, startDate?: string, endDate?: string): Promise<EventsResponse> {
    let url = `/api/workspaces/${workspaceId}/events`;
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (params.toString()) url += `?${params.toString()}`;
    return this.request<EventsResponse>(url);
  }

  async createEvent(workspaceId: number, data: CreateEventRequest): Promise<CalendarEvent> {
    return this.request<CalendarEvent>(`/api/workspaces/${workspaceId}/events`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateEvent(workspaceId: number, eventId: number, data: Partial<CreateEventRequest>): Promise<CalendarEvent> {
    return this.request<CalendarEvent>(`/api/workspaces/${workspaceId}/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteEvent(workspaceId: number, eventId: number): Promise<{ message: string }> {
    return this.request(`/api/workspaces/${workspaceId}/events/${eventId}`, {
      method: 'DELETE',
    });
  }

  async updateEventStatus(workspaceId: number, eventId: number, status: 'PENDING' | 'ACCEPTED' | 'DECLINED'): Promise<{ message: string; status: string }> {
    return this.request(`/api/workspaces/${workspaceId}/events/${eventId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  }

  // ========== 저장소 API ==========
  async getWorkspaceFiles(workspaceId: number, parentFolderId?: number): Promise<FilesResponse> {
    let url = `/api/workspaces/${workspaceId}/files`;
    if (parentFolderId) url += `?parent_folder_id=${parentFolderId}`;
    return this.request<FilesResponse>(url);
  }

  async createFolder(workspaceId: number, name: string, parentFolderId?: number): Promise<WorkspaceFile> {
    return this.request<WorkspaceFile>(`/api/workspaces/${workspaceId}/files/folder`, {
      method: 'POST',
      body: JSON.stringify({ name, parent_folder_id: parentFolderId }),
    });
  }

  async uploadFileMetadata(workspaceId: number, data: {
    name: string;
    file_url: string;
    file_size: number;
    mime_type: string;
    parent_folder_id?: number;
  }): Promise<WorkspaceFile> {
    return this.request<WorkspaceFile>(`/api/workspaces/${workspaceId}/files`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteFile(workspaceId: number, fileId: number): Promise<{ message: string }> {
    return this.request(`/api/workspaces/${workspaceId}/files/${fileId}`, {
      method: 'DELETE',
    });
  }

  async renameFile(workspaceId: number, fileId: number, name: string): Promise<WorkspaceFile> {
    return this.request<WorkspaceFile>(`/api/workspaces/${workspaceId}/files/${fileId}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  }

  // ========== S3 파일 업로드 API ==========
  async getPresignedURL(workspaceId: number, fileName: string, contentType: string, parentFolderId?: number): Promise<{
    upload_url: string;
    key: string;
    expires_at: string;
    parent_folder_id?: number;
  }> {
    return this.request(`/api/workspaces/${workspaceId}/files/presign`, {
      method: 'POST',
      body: JSON.stringify({
        file_name: fileName,
        content_type: contentType,
        parent_folder_id: parentFolderId,
      }),
    });
  }

  async confirmUpload(workspaceId: number, data: {
    name: string;
    key: string;
    file_size: number;
    mime_type: string;
    parent_folder_id?: number;
  }): Promise<WorkspaceFile> {
    return this.request<WorkspaceFile>(`/api/workspaces/${workspaceId}/files/confirm`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getDownloadURL(workspaceId: number, fileId: number): Promise<{ url: string }> {
    return this.request(`/api/workspaces/${workspaceId}/files/${fileId}/download`);
  }

  // 파일을 S3에 직접 업로드 (Presigned URL 사용)
  async uploadFileToS3(uploadUrl: string, file: File): Promise<void> {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to upload file to S3');
    }
  }

  // ========== 알림 API ==========
  async getMyNotifications(): Promise<NotificationsResponse> {
    return this.request<NotificationsResponse>('/api/notifications');
  }

  async acceptInvitation(notificationId: number): Promise<{ message: string; workspace_id: number }> {
    return this.request(`/api/notifications/${notificationId}/accept`, {
      method: 'POST',
    });
  }

  async declineInvitation(notificationId: number): Promise<{ message: string }> {
    return this.request(`/api/notifications/${notificationId}/decline`, {
      method: 'POST',
    });
  }

  async markNotificationAsRead(notificationId: number): Promise<{ message: string }> {
    return this.request(`/api/notifications/${notificationId}/read`, {
      method: 'POST',
    });
  }

  // ========== 비디오 통화 API ==========
  async getVideoToken(roomName: string, participantName?: string): Promise<{ token: string }> {
    return this.request<{ token: string }>('/api/video/token', {
      method: 'POST',
      body: JSON.stringify({ roomName, participantName }),
    });
  }

  async getRoomParticipants(roomName: string): Promise<{ roomName: string; participants: { identity: string; name: string; joinedAt: number }[] }> {
    return this.request(`/api/video/participants?roomName=${encodeURIComponent(roomName)}`);
  }

  async getAllRoomsParticipants(roomNames: string[]): Promise<Record<string, { identity: string; name: string; joinedAt: number }[]>> {
    return this.request(`/api/video/rooms/participants?rooms=${roomNames.map(r => encodeURIComponent(r)).join(',')}`);
  }

  // ========== 화이트보드 API ==========
  async getWhiteboardHistory(roomName: string): Promise<WhiteboardResponse> {
    return this.request<WhiteboardResponse>(`/api/whiteboard?room=${roomName}`);
  }

  async handleWhiteboardAction(roomName: string, action: { type?: string; stroke?: unknown }): Promise<WhiteboardResponse> {
    return this.request<WhiteboardResponse>('/api/whiteboard', {
      method: 'POST',
      body: JSON.stringify({ room: roomName, ...action }),
    });
  }

  // ========== 음성 기록 API ==========
  async getVoiceRecords(workspaceId: number, meetingId: number, limit = 100, offset = 0): Promise<VoiceRecordsResponse> {
    return this.request<VoiceRecordsResponse>(
      `/api/workspaces/${workspaceId}/meetings/${meetingId}/voice-records?limit=${limit}&offset=${offset}`
    );
  }

  async createVoiceRecord(workspaceId: number, meetingId: number, data: CreateVoiceRecordRequest): Promise<VoiceRecord> {
    return this.request<VoiceRecord>(`/api/workspaces/${workspaceId}/meetings/${meetingId}/voice-records`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createVoiceRecordBulk(workspaceId: number, meetingId: number, records: CreateVoiceRecordRequest[]): Promise<{ message: string; count: number }> {
    return this.request(`/api/workspaces/${workspaceId}/meetings/${meetingId}/voice-records/bulk`, {
      method: 'POST',
      body: JSON.stringify({ records }),
    });
  }

  async deleteVoiceRecords(workspaceId: number, meetingId: number): Promise<{ message: string; count: number }> {
    return this.request(`/api/workspaces/${workspaceId}/meetings/${meetingId}/voice-records`, {
      method: 'DELETE',
    });
  }
}

export const apiClient = new ApiClient();
export type {
  AuthResponse,
  UserSearchResult,
  SearchUsersResponse,
  Workspace,
  WorkspaceMember,
  WorkspacesResponse,
  CreateWorkspaceRequest,
  // Chat
  ChatMessage,
  ChatsResponse,
  // Chat Room
  ChatRoom,
  ChatRoomsResponse,
  ChatRoomMessagesResponse,
  // Meeting
  Meeting,
  Participant,
  MeetingsResponse,
  CreateMeetingRequest,
  // Calendar
  CalendarEvent,
  EventAttendee,
  EventsResponse,
  CreateEventRequest,
  // Storage
  WorkspaceFile,
  FilesResponse,
  // Notification
  Notification,
  NotificationsResponse,
  // Role
  Role,
  // Voice Record
  VoiceRecord,
  VoiceRecordsResponse,
  CreateVoiceRecordRequest,
};
