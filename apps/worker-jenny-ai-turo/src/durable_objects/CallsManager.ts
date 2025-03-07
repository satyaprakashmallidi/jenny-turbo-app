export class CallsManager {
    private state: DurableObjectState;
    private activeCalls: Record<string, any> = {};

    constructor(state: DurableObjectState) {
        this.state = state;
    }

    async fetch(request: Request) {
        const url = new URL(request.url);
        const method = request.method;
        const callId = url.pathname.split('/').pop();

        switch (method) {
            case 'POST':
                const callData = await request.json();
                this.activeCalls[callId] = callData;
                return new Response('OK');

            case 'GET':
                const call = this.activeCalls[callId];
                return new Response(JSON.stringify(call || null));

            case 'DELETE':
                delete this.activeCalls[callId];
                return new Response('OK');

            default:
                return new Response('Method not allowed', { status: 405 });
        }
    }
} 