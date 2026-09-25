class ApplicationController < ActionController::API
  before_action :authenticate!

  private

  def authenticate!
    head :unauthorized unless current_user
  end

  def current_user
    @current_user ||= User.find_by(id: request.headers['X-User-Id'])
  end
end
