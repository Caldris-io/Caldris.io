const { WaitlistForm } = require('./waitlist-form');

describe('WaitlistForm', () => {
  let form, emailInput, button, waitlistForm;

  beforeEach(() => {
    // Set up DOM
    document.body.innerHTML = `
      <form class="waitlist-form" id="waitlist-hero">
        <input type="email" placeholder="you@company.com" required>
        <button type="submit">Join Waitlist</button>
      </form>
    `;

    form = document.querySelector('.waitlist-form');
    emailInput = form.querySelector('input[type="email"]');
    button = form.querySelector('button');
    waitlistForm = new WaitlistForm(form);

    // Mock fetch
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    // Mock PostHog
    global.window = { posthog: global.posthog };
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('Constructor and Initialization', () => {
    test('should initialize with correct form elements', () => {
      expect(waitlistForm.form).toBe(form);
      expect(waitlistForm.emailInput).toBe(emailInput);
      expect(waitlistForm.button).toBe(button);
      expect(waitlistForm.formId).toBe('waitlist-hero');
      expect(waitlistForm.originalButtonText).toBe('Join Waitlist');
    });

    test('should have correct Formsubmit URL', () => {
      expect(waitlistForm.formsubmitUrl).toBe('https://formsubmit.co/chris@caldris.io');
    });
  });

  describe('getSignupSource', () => {
    test('should return "hero" for waitlist-hero form', () => {
      expect(waitlistForm.getSignupSource()).toBe('hero');
    });

    test('should return "cta" for waitlist-cta form', () => {
      form.id = 'waitlist-cta';
      waitlistForm = new WaitlistForm(form);
      expect(waitlistForm.getSignupSource()).toBe('cta');
    });
  });

  describe('validateEmail', () => {
    test('should validate correct email formats', () => {
      expect(waitlistForm.validateEmail('test@example.com')).toBe(true);
      expect(waitlistForm.validateEmail('user.name+tag@example.co.uk')).toBe(true);
      expect(waitlistForm.validateEmail('first.last@subdomain.example.com')).toBe(true);
    });

    test('should reject invalid email formats', () => {
      expect(waitlistForm.validateEmail('invalid')).toBe(false);
      expect(waitlistForm.validateEmail('invalid@')).toBe(false);
      expect(waitlistForm.validateEmail('@example.com')).toBe(false);
      expect(waitlistForm.validateEmail('invalid@example')).toBe(false);
      expect(waitlistForm.validateEmail('')).toBe(false);
    });
  });

  describe('setButtonState', () => {
    test('should update button text and disabled state', () => {
      waitlistForm.setButtonState('Loading...', true);
      expect(button.textContent).toBe('Loading...');
      expect(button.disabled).toBe(true);
    });

    test('should apply custom styles', () => {
      waitlistForm.setButtonState('Success', false, {
        background: '#0057B8',
        borderColor: '#0057B8'
      });
      expect(button.textContent).toBe('Success');
      expect(button.disabled).toBe(false);
      // JSDOM converts hex colors to rgb format
      expect(button.style.background).toBeTruthy();
      expect(button.style.borderColor).toBeTruthy();
    });
  });

  describe('resetButton', () => {
    test('should reset button to original state', () => {
      // Change button state
      waitlistForm.setButtonState('Changed', true, {
        background: '#0057B8',
        borderColor: '#0057B8'
      });

      // Reset
      waitlistForm.resetButton();

      expect(button.textContent).toBe('Join Waitlist');
      expect(button.disabled).toBe(false);
      expect(button.style.background).toBe('');
      expect(button.style.borderColor).toBe('');
    });
  });

  describe('buildFormData', () => {
    test('should build correct FormData object', () => {
      const email = 'test@example.com';
      const formData = waitlistForm.buildFormData(email);

      expect(formData.get('email')).toBe(email);
      expect(formData.get('source')).toBe('hero');
      expect(formData.get('timestamp')).toBeTruthy();
      expect(formData.get('_subject')).toBe('New Caldris Waitlist Signup');
      expect(formData.get('_captcha')).toBe('false');
      expect(formData.get('_template')).toBe('table');
    });

    test('should include correct source for CTA form', () => {
      form.id = 'waitlist-cta';
      waitlistForm = new WaitlistForm(form);
      const formData = waitlistForm.buildFormData('test@example.com');

      expect(formData.get('source')).toBe('cta');
    });

    test('should include valid ISO timestamp', () => {
      const formData = waitlistForm.buildFormData('test@example.com');
      const timestamp = formData.get('timestamp');
      const date = new Date(timestamp);

      expect(date.toISOString()).toBe(timestamp);
      expect(date.getTime()).not.toBeNaN();
    });
  });

  describe('submitToFormsubmit', () => {
    test('should submit form data to Formsubmit', async () => {
      const email = 'test@example.com';

      await waitlistForm.submitToFormsubmit(email);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://formsubmit.co/chris@caldris.io',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(FormData)
        })
      );
    });

    test('should throw error on failed submission', async () => {
      global.fetch.mockResolvedValueOnce({ ok: false });

      await expect(
        waitlistForm.submitToFormsubmit('test@example.com')
      ).rejects.toThrow('Submission failed');
    });
  });

  describe('trackWithPostHog', () => {
    test('should identify user and capture event when PostHog is available', () => {
      const email = 'test@example.com';

      waitlistForm.trackWithPostHog(email);

      expect(global.posthog.identify).toHaveBeenCalledWith(
        email,
        expect.objectContaining({
          email: email,
          waitlist_status: 'pending',
          waitlist_join_date: expect.any(String)
        })
      );

      expect(global.posthog.capture).toHaveBeenCalledWith(
        'waitlist_joined',
        expect.objectContaining({
          signup_source: 'hero',
          $set: expect.objectContaining({
            email: email,
            waitlist_status: 'pending',
            waitlist_join_date: expect.any(String)
          })
        })
      );
    });

    test('should handle missing PostHog gracefully', () => {
      const originalPosthog = global.window.posthog;
      delete global.window.posthog;

      expect(() => {
        waitlistForm.trackWithPostHog('test@example.com');
      }).not.toThrow();

      // Restore for other tests
      global.window.posthog = originalPosthog;
    });

    test('should include correct source for CTA form', () => {
      form.id = 'waitlist-cta';
      waitlistForm = new WaitlistForm(form);

      waitlistForm.trackWithPostHog('test@example.com');

      expect(global.posthog.capture).toHaveBeenCalledWith(
        'waitlist_joined',
        expect.objectContaining({
          signup_source: 'cta'
        })
      );
    });
  });

  describe('showSuccess', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should show success message and clear email', () => {
      emailInput.value = 'test@example.com';

      waitlistForm.showSuccess();

      expect(button.textContent).toBe('You\'re in!');
      expect(button.disabled).toBe(true);
      // JSDOM converts hex colors to rgb format
      expect(button.style.background).toBeTruthy();
      expect(button.style.borderColor).toBeTruthy();
      expect(emailInput.value).toBe('');
    });

    test('should reset button after 3 seconds', () => {
      waitlistForm.showSuccess();

      expect(button.textContent).toBe('You\'re in!');

      jest.advanceTimersByTime(3000);

      expect(button.textContent).toBe('Join Waitlist');
      expect(button.disabled).toBe(false);
      expect(button.style.background).toBe('');
      expect(button.style.borderColor).toBe('');
    });
  });

  describe('showError', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should show error message', () => {
      waitlistForm.showError();

      expect(button.textContent).toBe('Error - Try again');
      expect(button.disabled).toBe(false);
    });

    test('should reset button after 2 seconds', () => {
      waitlistForm.showError();

      expect(button.textContent).toBe('Error - Try again');

      jest.advanceTimersByTime(2000);

      expect(button.textContent).toBe('Join Waitlist');
    });
  });

  describe('handleSubmit', () => {
    let event;

    beforeEach(() => {
      jest.useFakeTimers();
      event = {
        preventDefault: jest.fn()
      };
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should prevent default form submission', async () => {
      emailInput.value = 'test@example.com';

      await waitlistForm.handleSubmit(event);

      expect(event.preventDefault).toHaveBeenCalled();
    });

    test('should show error for invalid email', async () => {
      emailInput.value = 'invalid-email';

      await waitlistForm.handleSubmit(event);

      expect(button.textContent).toBe('Error - Try again');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should successfully submit valid email', async () => {
      emailInput.value = 'test@example.com';

      // handleSubmit is async and will complete immediately with our mock
      await waitlistForm.handleSubmit(event);

      // After completion, check the results
      expect(global.fetch).toHaveBeenCalled();
      expect(global.posthog.identify).toHaveBeenCalledWith(
        'test@example.com',
        expect.any(Object)
      );
      expect(button.textContent).toBe('You\'re in!');
    });

    test('should trim whitespace from email', async () => {
      emailInput.value = '  test@example.com  ';

      await waitlistForm.handleSubmit(event);
      await Promise.resolve();

      expect(global.posthog.identify).toHaveBeenCalledWith(
        'test@example.com',
        expect.any(Object)
      );
    });

    test('should show error on submission failure', async () => {
      emailInput.value = 'test@example.com';
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      await waitlistForm.handleSubmit(event);
      await Promise.resolve();

      expect(button.textContent).toBe('Error - Try again');
    });

    test('should set loading state during submission', async () => {
      emailInput.value = 'test@example.com';

      let resolveFetch;
      global.fetch.mockImplementationOnce(() => new Promise(resolve => {
        resolveFetch = resolve;
      }));

      const submitPromise = waitlistForm.handleSubmit(event);

      // Check loading state immediately
      expect(button.textContent).toBe('Joining...');
      expect(button.disabled).toBe(true);

      // Resolve the fetch
      resolveFetch({ ok: true });
      await submitPromise;
    });
  });

  describe('Integration tests', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('should complete full submission flow successfully', async () => {
      const email = 'user@company.com';
      emailInput.value = email;

      waitlistForm.init();
      const submitEvent = new Event('submit');
      form.dispatchEvent(submitEvent);

      // Let promises resolve but don't run timers yet
      await Promise.resolve();
      await Promise.resolve();

      // Verify submission
      expect(global.fetch).toHaveBeenCalledWith(
        'https://formsubmit.co/chris@caldris.io',
        expect.objectContaining({ method: 'POST' })
      );

      // Verify PostHog tracking
      expect(global.posthog.identify).toHaveBeenCalledWith(
        email,
        expect.objectContaining({ email })
      );
      expect(global.posthog.capture).toHaveBeenCalledWith(
        'waitlist_joined',
        expect.any(Object)
      );

      // Verify success state
      expect(button.textContent).toBe('You\'re in!');
      expect(emailInput.value).toBe('');

      // Verify reset after timeout
      jest.advanceTimersByTime(3000);
      expect(button.textContent).toBe('Join Waitlist');
      expect(button.disabled).toBe(false);
    });

    test('should handle submission error gracefully', async () => {
      emailInput.value = 'test@example.com';
      global.fetch.mockRejectedValueOnce(new Error('Server error'));

      waitlistForm.init();
      form.dispatchEvent(new Event('submit'));

      // Let promises resolve but don't run timers yet
      await Promise.resolve();
      await Promise.resolve();

      expect(button.textContent).toBe('Error - Try again');
      expect(button.disabled).toBe(false);

      jest.advanceTimersByTime(2000);
      expect(button.textContent).toBe('Join Waitlist');
    });
  });
});
