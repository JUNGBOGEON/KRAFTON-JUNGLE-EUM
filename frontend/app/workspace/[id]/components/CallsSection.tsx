'use client';

import VideoCallFeature from "./VideoCallFeature";

interface CallParticipant {
  id: number;
  nickname: string;
  profileImg?: string;
}

interface ActiveCall {
  channelId: string;
  channelName: string;
  participants: CallParticipant[];
}

interface CallsSectionProps {
  workspaceId: number;
  channelId?: string;
  activeCall?: ActiveCall | null;
  onJoinCall?: (channelId: string, channelName: string) => void;
  onLeaveCall?: () => void;
  // 현재 채널에 있는 다른 참여자들 (나중에 실제 데이터로 교체)
  channelParticipants?: CallParticipant[];
  canConnectMedia?: boolean;
}

// 채널 ID로 이름 가져오기
const getChannelName = (channelId: string): string => {
  const channelNames: Record<string, string> = {
    "call-general": "일반 통화",
    "call-standup": "스탠드업 미팅",
    "call-brainstorm": "브레인스토밍",
  };
  return channelNames[channelId] || channelId.replace("call-", "");
};

export default function CallsSection({
  workspaceId,
  channelId,
  activeCall,
  onJoinCall,
  onLeaveCall,
  channelParticipants = [],
  canConnectMedia = true,
}: CallsSectionProps) {
  const channelName = channelId ? getChannelName(channelId) : "통화";
  const hasParticipants = channelParticipants.length > 0;

  // 통화에 연결된 경우 → 통화 화면 표시
  if (activeCall && activeCall.channelId === channelId) {
    return (
      <div className="h-full bg-white">
        <VideoCallFeature
          roomId={`workspace-${workspaceId}-${channelId}`}
          roomTitle={activeCall.channelName}
          onLeave={() => {
            onLeaveCall?.();
          }}
        />
      </div>
    );
  }

  // 통화에 연결되지 않은 경우 → 대기 화면
  return (
    <div className="h-full bg-[#1a1a1a] flex flex-col items-center justify-center">
      {/* 아이콘 */}
      <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-6">
        <svg className="w-10 h-10 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15.536a5 5 0 001.414 1.414m2.828-9.9a9 9 0 012.728-2.728" />
        </svg>
      </div>

      {/* 채널 이름 */}
      <h2 className="text-xl font-semibold text-white mb-3">{channelName}</h2>

      {/* 참여자 목록 또는 빈 상태 */}
      {hasParticipants ? (
        <div className="mb-8">
          {/* 참여자 아바타들 */}
          <div className="flex items-center justify-center -space-x-2 mb-3">
            {channelParticipants.slice(0, 5).map((participant) => (
              participant.profileImg ? (
                <img
                  key={participant.id}
                  src={participant.profileImg}
                  alt={participant.nickname}
                  className="w-10 h-10 rounded-full border-2 border-[#1a1a1a] object-cover"
                />
              ) : (
                <div
                  key={participant.id}
                  className="w-10 h-10 rounded-full border-2 border-[#1a1a1a] bg-green-500 flex items-center justify-center"
                >
                  <span className="text-sm font-medium text-white">
                    {participant.nickname.charAt(0).toUpperCase()}
                  </span>
                </div>
              )
            ))}
            {channelParticipants.length > 5 && (
              <div className="w-10 h-10 rounded-full border-2 border-[#1a1a1a] bg-white/10 flex items-center justify-center">
                <span className="text-xs font-medium text-white">
                  +{channelParticipants.length - 5}
                </span>
              </div>
            )}
          </div>
          {/* 참여자 이름들 */}
          <p className="text-white/50 text-sm text-center">
            {channelParticipants.slice(0, 3).map(p => p.nickname).join(", ")}
            {channelParticipants.length > 3 && ` 외 ${channelParticipants.length - 3}명`}
          </p>
        </div>
      ) : (
        <p className="text-white/40 text-sm mb-8">
          음성 채널에 아무도 없습니다
        </p>
      )}

      {/* 참여하기 버튼 */}
      {canConnectMedia ? (
        <button
          onClick={() => channelId && onJoinCall?.(channelId, channelName)}
          className="flex items-center gap-2 px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-xl transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
          참여하기
        </button>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <button
            disabled
            className="flex items-center gap-2 px-6 py-3 bg-stone-700/50 text-white/30 font-medium rounded-xl cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            접근 제한
          </button>
          <p className="text-white/30 text-xs">음성 채널 참여 권한이 없습니다</p>
        </div>
      )}
    </div>
  );
}
