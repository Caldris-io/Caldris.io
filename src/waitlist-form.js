/**
 * Waitlist form handler for Caldris.io
 * Handles form submission to Formsubmit and PostHog tracking
 */

class WaitlistForm {
  constructor(formElement) {
    this.form = formElement;
    this.emailInput = formElement.querySelector('input[type="email"]');
    this.button = formElement.querySelector('button');
    this.formId = formElement.id;
    this.originalButtonText = this.button.textContent;
    this.formsubmitUrl = 'https://formsubmit.co/chris@caldris.io';
  }

  /**
   * Get the signup source based on form ID
   */
  getSignupSource() {
    return this.formId === 'waitlist-hero' ? 'hero' : 'cta';
  }

  /**
   * Validate email format
   */
  validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Set button state
   */
  setButtonState(text, disabled, style = {}) {
    this.button.textContent = text;
    this.button.disabled = disabled;
    Object.assign(this.button.style, style);
  }

  /**
   * Reset button to original state
   */
  resetButton() {
    this.setButtonState(this.originalButtonText, false, {
      background: '',
      borderColor: ''
    });
  }

  /**
   * Build form data for submission
   */
  buildFormData(email) {
    const formData = new FormData();
    formData.append('email', email);
    formData.append('source', this.getSignupSource());
    formData.append('timestamp', new Date().toISOString());
    formData.append('_subject', 'New Caldris Waitlist Signup');
    formData.append('_captcha', 'false');
    formData.append('_template', 'table');
    return formData;
  }

  /**
   * Submit form to Formsubmit
   */
  async submitToFormsubmit(email) {
    const formData = this.buildFormData(email);

    console.log('🔵 [DEBUG] Submitting to Formsubmit:', {
      url: this.formsubmitUrl,
      email: email,
      source: this.getSignupSource(),
      timestamp: new Date().toISOString()
    });

    const response = await fetch(this.formsubmitUrl, {
      method: 'POST',
      body: formData
    });

    console.log('🔵 [DEBUG] Formsubmit response:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: {
        contentType: response.headers.get('content-type'),
        location: response.headers.get('location')
      }
    });

    // Try to get response body for debugging
    const responseText = await response.text();
    console.log('🔵 [DEBUG] Formsubmit response body:', responseText);

    if (!response.ok) {
      throw new Error(`Submission failed: ${response.status} ${response.statusText} - ${responseText}`);
    }

    return response;
  }

  /**
   * Track submission with PostHog
   */
  trackWithPostHog(email) {
    if (typeof window !== 'undefined' && window.posthog) {
      const timestamp = new Date().toISOString();

      // Identify user by email
      window.posthog.identify(email, {
        email: email,
        waitlist_status: 'pending',
        waitlist_join_date: timestamp
      });

      // Capture the waitlist event with properties
      window.posthog.capture('waitlist_joined', {
        signup_source: this.getSignupSource(),
        $set: {
          email: email,
          waitlist_status: 'pending',
          waitlist_join_date: timestamp
        }
      });
    }
  }

  /**
   * Show success state
   */
  showSuccess() {
    this.setButtonState('You\'re in!', true, {
      background: '#0057B8',
      borderColor: '#0057B8'
    });
    this.emailInput.value = '';

    setTimeout(() => {
      this.resetButton();
    }, 3000);
  }

  /**
   * Show error state
   */
  showError() {
    this.setButtonState('Error - Try again', false);

    setTimeout(() => {
      this.resetButton();
    }, 2000);
  }

  /**
   * Handle form submission
   */
  async handleSubmit(e) {
    e.preventDefault();
    const email = this.emailInput.value.trim();

    // Validate email
    if (!this.validateEmail(email)) {
      this.showError();
      return;
    }

    // Set loading state
    this.setButtonState('Joining...', true);

    try {
      // Submit to Formsubmit
      console.log('🔵 [DEBUG] Starting form submission for:', email);
      await this.submitToFormsubmit(email);

      // Track with PostHog
      console.log('🔵 [DEBUG] Tracking with PostHog');
      this.trackWithPostHog(email);

      // Show success
      console.log('✅ [DEBUG] Form submission successful!');
      this.showSuccess();
    } catch (error) {
      console.error('❌ [DEBUG] Form submission error:', {
        message: error.message,
        stack: error.stack,
        error: error
      });
      this.showError();
    }
  }

  /**
   * Initialize form handler
   */
  init() {
    this.form.addEventListener('submit', (e) => this.handleSubmit(e));
  }
}

/**
 * Initialize all waitlist forms on the page
 */
function initializeWaitlistForms() {
  if (typeof document !== 'undefined') {
    document.querySelectorAll('.waitlist-form').forEach(form => {
      const waitlistForm = new WaitlistForm(form);
      waitlistForm.init();
    });
  }
}

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WaitlistForm, initializeWaitlistForms };
}
