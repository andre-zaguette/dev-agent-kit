require 'rails_helper'

RSpec.describe 'Notes', type: :request do
  it 'requires authentication' do
    get '/notes'
    expect(response).to have_http_status(:unauthorized)
  end
end
