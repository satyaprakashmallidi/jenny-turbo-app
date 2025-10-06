/**
 * Concurrency Management Service
 * Manages Ultravox API concurrency limits using KV storage
 */

export interface PendingCallPayload {
  job_id: string;
  payload: any;
  queued_at: string;
}

export class ConcurrencyService {
  private static instance: ConcurrencyService;
  private env: any;

  // KV Keys
  private readonly CONCURRENCY_COUNT_KEY = 'ultravox_active_calls_count';
  private readonly MAX_CONCURRENCY = 20; // Ultravox limit
  private readonly PENDING_CALLS_PREFIX = 'pending_call:';
  private readonly PENDING_CALLS_INDEX_KEY = 'pending_calls_index'; // Ordered list of pending call IDs

  private constructor() {}

  public static getInstance(): ConcurrencyService {
    if (!ConcurrencyService.instance) {
      ConcurrencyService.instance = new ConcurrencyService();
    }
    return ConcurrencyService.instance;
  }

  public setDependencies(env: any) {
    this.env = env;
  }

  /**
   * Get current active calls count
   */
  async getCurrentConcurrency(): Promise<number> {
    try {
      const count = await this.env.ACTIVE_CALLS.get(this.CONCURRENCY_COUNT_KEY);
      return count ? parseInt(count) : 0;
    } catch (error) {
      console.error('Error getting concurrency count:', error);
      return 0;
    }
  }

  /**
   * Increment active calls count
   * Returns true if slot was available, false if at max capacity
   */
  async incrementConcurrency(): Promise<boolean> {
    try {
      const currentCount = await this.getCurrentConcurrency();

      if (currentCount >= this.MAX_CONCURRENCY) {
        console.log(`⚠️ Max concurrency reached: ${currentCount}/${this.MAX_CONCURRENCY}`);
        return false;
      }

      const newCount = currentCount + 1;
      await this.env.ACTIVE_CALLS.put(this.CONCURRENCY_COUNT_KEY, newCount.toString());
      console.log(`📈 Concurrency increased: ${newCount}/${this.MAX_CONCURRENCY}`);
      return true;
    } catch (error) {
      console.error('Error incrementing concurrency:', error);
      return false;
    }
  }

  /**
   * Decrement active calls count
   */
  async decrementConcurrency(): Promise<number> {
    try {
      const currentCount = await this.getCurrentConcurrency();
      const newCount = Math.max(0, currentCount - 1);

      await this.env.ACTIVE_CALLS.put(this.CONCURRENCY_COUNT_KEY, newCount.toString());
      console.log(`📉 Concurrency decreased: ${newCount}/${this.MAX_CONCURRENCY}`);

      return newCount;
    } catch (error) {
      console.error('Error decrementing concurrency:', error);
      return 0;
    }
  }

  /**
   * Check if there are available slots
   */
  async hasAvailableSlots(): Promise<boolean> {
    const currentCount = await this.getCurrentConcurrency();
    return currentCount < this.MAX_CONCURRENCY;
  }

  /**
   * Get number of available slots
   */
  async getAvailableSlots(): Promise<number> {
    const currentCount = await this.getCurrentConcurrency();
    return Math.max(0, this.MAX_CONCURRENCY - currentCount);
  }

  /**
   * Store a pending call in KV buffer
   */
  async addPendingCall(payload: PendingCallPayload): Promise<void> {
    try {
      const callKey = `${this.PENDING_CALLS_PREFIX}${payload.job_id}`;

      // Store the call payload
      await this.env.ACTIVE_CALLS.put(callKey, JSON.stringify(payload), {
        expirationTtl: 86400 // 24 hours expiration
      });

      // Add to index for FIFO ordering
      await this.addToIndex(payload.job_id);

      console.log(`💾 Stored pending call in KV buffer: ${payload.job_id}`);
    } catch (error) {
      console.error('Error storing pending call:', error);
      throw error;
    }
  }

  /**
   * Add job_id to the pending calls index (FIFO queue)
   */
  private async addToIndex(job_id: string): Promise<void> {
    try {
      const indexData = await this.env.ACTIVE_CALLS.get(this.PENDING_CALLS_INDEX_KEY);
      const index: string[] = indexData ? JSON.parse(indexData) : [];

      // Add to end of queue (FIFO)
      index.push(job_id);

      await this.env.ACTIVE_CALLS.put(this.PENDING_CALLS_INDEX_KEY, JSON.stringify(index));
    } catch (error) {
      console.error('Error updating pending calls index:', error);
      throw error;
    }
  }

  /**
   * Remove job_id from the pending calls index
   */
  private async removeFromIndex(job_id: string): Promise<void> {
    try {
      const indexData = await this.env.ACTIVE_CALLS.get(this.PENDING_CALLS_INDEX_KEY);
      if (!indexData) return;

      const index: string[] = JSON.parse(indexData);
      const newIndex = index.filter(id => id !== job_id);

      await this.env.ACTIVE_CALLS.put(this.PENDING_CALLS_INDEX_KEY, JSON.stringify(newIndex));
    } catch (error) {
      console.error('Error removing from pending calls index:', error);
    }
  }

  /**
   * Get the next pending call (FIFO)
   */
  async getNextPendingCall(): Promise<PendingCallPayload | null> {
    try {
      // Get the index
      const indexData = await this.env.ACTIVE_CALLS.get(this.PENDING_CALLS_INDEX_KEY);
      if (!indexData) {
        return null;
      }

      const index: string[] = JSON.parse(indexData);
      if (index.length === 0) {
        return null;
      }

      // Get first job_id (FIFO)
      const job_id = index[0];
      const callKey = `${this.PENDING_CALLS_PREFIX}${job_id}`;

      // Retrieve the call payload
      const callData = await this.env.ACTIVE_CALLS.get(callKey);
      if (!callData) {
        // Call data missing, remove from index and try next
        await this.removeFromIndex(job_id);
        return this.getNextPendingCall(); // Recursive call to get next
      }

      const payload: PendingCallPayload = JSON.parse(callData);

      // Remove from KV and index
      await this.env.ACTIVE_CALLS.delete(callKey);
      await this.removeFromIndex(job_id);

      console.log(`📤 Retrieved pending call from buffer: ${job_id}`);
      return payload;
    } catch (error) {
      console.error('Error getting next pending call:', error);
      return null;
    }
  }

  /**
   * Get count of pending calls in buffer
   */
  async getPendingCallsCount(): Promise<number> {
    try {
      const indexData = await this.env.ACTIVE_CALLS.get(this.PENDING_CALLS_INDEX_KEY);
      if (!indexData) return 0;

      const index: string[] = JSON.parse(indexData);
      return index.length;
    } catch (error) {
      console.error('Error getting pending calls count:', error);
      return 0;
    }
  }

  /**
   * Remove a specific pending call from buffer
   */
  async removePendingCall(job_id: string): Promise<void> {
    try {
      const callKey = `${this.PENDING_CALLS_PREFIX}${job_id}`;
      await this.env.ACTIVE_CALLS.delete(callKey);
      await this.removeFromIndex(job_id);

      console.log(`🗑️ Removed pending call from buffer: ${job_id}`);
    } catch (error) {
      console.error('Error removing pending call:', error);
    }
  }

  /**
   * Get stats about concurrency and pending calls
   */
  async getStats(): Promise<{
    active_calls: number;
    max_concurrency: number;
    available_slots: number;
    pending_calls: number;
    utilization_percentage: number;
  }> {
    const activeCalls = await this.getCurrentConcurrency();
    const pendingCalls = await this.getPendingCallsCount();
    const availableSlots = this.MAX_CONCURRENCY - activeCalls;
    const utilizationPercentage = (activeCalls / this.MAX_CONCURRENCY) * 100;

    return {
      active_calls: activeCalls,
      max_concurrency: this.MAX_CONCURRENCY,
      available_slots: availableSlots,
      pending_calls: pendingCalls,
      utilization_percentage: Math.round(utilizationPercentage * 100) / 100
    };
  }

  /**
   * Reset concurrency count (use with caution, mainly for debugging)
   */
  async resetConcurrency(): Promise<void> {
    try {
      await this.env.ACTIVE_CALLS.put(this.CONCURRENCY_COUNT_KEY, '0');
      console.log('🔄 Concurrency count reset to 0');
    } catch (error) {
      console.error('Error resetting concurrency:', error);
    }
  }

  /**
   * Clear all pending calls (use with caution)
   */
  async clearPendingCalls(): Promise<number> {
    try {
      const indexData = await this.env.ACTIVE_CALLS.get(this.PENDING_CALLS_INDEX_KEY);
      if (!indexData) return 0;

      const index: string[] = JSON.parse(indexData);
      const count = index.length;

      // Delete all pending call records
      for (const job_id of index) {
        const callKey = `${this.PENDING_CALLS_PREFIX}${job_id}`;
        await this.env.ACTIVE_CALLS.delete(callKey);
      }

      // Clear the index
      await this.env.ACTIVE_CALLS.put(this.PENDING_CALLS_INDEX_KEY, JSON.stringify([]));

      console.log(`🧹 Cleared ${count} pending calls from buffer`);
      return count;
    } catch (error) {
      console.error('Error clearing pending calls:', error);
      return 0;
    }
  }
}
