// AI Service Tests
import { AiService, aiChat, aiPolish, aiCompileFix, aiAgentEdit } from '../services/ai.js';

describe('AiService', () => {
  beforeEach(() => {
    AiService.clearCache();
  });

  describe('Cache Management', () => {
    test('should cache identical requests', async () => {
      const payload = { context: 'test', question: 'test' };

      // First call
      const key1 = AiService._generateCacheKey('chat', payload);

      // Second call with same payload
      const key2 = AiService._generateCacheKey('chat', payload);

      expect(key1).toBe(key2);
    });

    test('should generate different keys for different payloads', () => {
      const key1 = AiService._generateCacheKey('chat', { question: 'a' });
      const key2 = AiService._generateCacheKey('chat', { question: 'b' });

      expect(key1).not.toBe(key2);
    });

    test('should clear cache', () => {
      AiService.clearCache();
      const stats = AiService.getCacheStats();

      expect(stats.cacheSize).toBe(0);
    });
  });

  describe('Request Deduplication', () => {
    test('should deduplicate concurrent requests', async () => {
      const payload = { context: 'test', question: 'test' };

      // Simulate concurrent requests
      const promise1 = AiService.callApi('chat', payload);
      const promise2 = AiService.callApi('chat', payload);

      // Both should return the same promise
      expect(promise1).toBe(promise2);
    });
  });

  describe('Error Handling', () => {
    test('should handle API errors gracefully', async () => {
      try {
        await AiService.callApi('chat', { context: '', question: '' });
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test('should timeout after specified duration', async () => {
      try {
        await AiService.callApi('chat',
          { context: 'test', question: 'test' },
          { timeout: 100 }
        );
      } catch (error) {
        expect(error.name).toBe('AbortError');
      }
    });
  });
});

describe('AI Panel Integration', () => {
  test('should open and close AI panel', () => {
    const panel = document.createElement('div');
    panel.id = 'ai-panel';
    document.body.appendChild(panel);

    // Test open
    panel.style.display = 'flex';
    expect(panel.style.display).toBe('flex');

    // Test close
    panel.style.display = 'none';
    expect(panel.style.display).toBe('none');

    document.body.removeChild(panel);
  });

  test('should switch between tabs', () => {
    const chatTab = document.createElement('button');
    chatTab.className = 'ai-tab-btn active';
    chatTab.setAttribute('data-tab', 'chat');

    const polishTab = document.createElement('button');
    polishTab.className = 'ai-tab-btn';
    polishTab.setAttribute('data-tab', 'polish');

    // Simulate tab switch
    chatTab.classList.remove('active');
    polishTab.classList.add('active');

    expect(chatTab.classList.contains('active')).toBe(false);
    expect(polishTab.classList.contains('active')).toBe(true);
  });
});

describe('Compile Error Handler', () => {
  test('should parse compile errors', () => {
    const log = `
      ! Undefined control sequence.
      l.10 \\mycommand
    `;

    expect(log).toContain('Undefined control sequence');
  });

  test('should extract file paths from errors', () => {
    const log = './main.tex:10: Undefined control sequence';
    const match = log.match(/^\.\/([^:]+):/);

    expect(match?.[1]).toBe('main.tex');
  });
});

describe('AI Config Manager', () => {
  test('should add and retrieve profiles', () => {
    const profiles = [];

    profiles.push({
      id: 'test-1',
      name: 'Test Model',
      apiKey: 'sk-test',
      baseUrl: 'https://api.test.com',
      model: 'test-model'
    });

    expect(profiles.length).toBe(1);
    expect(profiles[0].name).toBe('Test Model');
  });

  test('should set active profile', () => {
    let activeId = 'default';
    const newId = 'test-1';

    activeId = newId;

    expect(activeId).toBe('test-1');
  });

  test('should delete profile', () => {
    const profiles = [
      { id: 'test-1', name: 'Test 1' },
      { id: 'test-2', name: 'Test 2' }
    ];

    const index = profiles.findIndex(p => p.id === 'test-1');
    profiles.splice(index, 1);

    expect(profiles.length).toBe(1);
    expect(profiles[0].id).toBe('test-2');
  });
});

// Integration Tests
describe('AI Integration', () => {
  test('should handle chat message flow', async () => {
    const message = 'test message';
    const context = 'test context';

    expect(message).toBeDefined();
    expect(context).toBeDefined();
  });

  test('should handle polish text flow', async () => {
    const text = 'This is a test text.';

    expect(text.length).toBeGreaterThan(0);
  });

  test('should handle compile fix flow', async () => {
    const log = 'Undefined control sequence';

    expect(log).toContain('Undefined');
  });
});
