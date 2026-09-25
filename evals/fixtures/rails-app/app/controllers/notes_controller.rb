class NotesController < ApplicationController
  def index
    render json: current_user.notes.order(:id).select(:id, :title)
  end
end
