
export async function getToken(roomName: string, participantName: string): Promise<string> {
    const response = await fetch(`/api/video/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            roomName,
            participantName,
        }),
    });

    if (!response.ok) {
        let errorMessage = 'Failed to get token';
        try {
            const error = await response.json();
            errorMessage = error.error || errorMessage;
        } catch {
            errorMessage = `Server Error: ${response.status} ${response.statusText}`;
        }
        throw new Error(errorMessage);
    }

    const data = await response.json();
    return data.token;
}
