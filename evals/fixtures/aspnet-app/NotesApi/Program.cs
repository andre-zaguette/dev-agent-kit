using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using NotesApi.Data;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Default")));
builder.Services.AddAuthentication().AddJwtBearer();
builder.Services.AddAuthorization();
builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/notes", async (ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
{
    var userId = Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);
    return await db.Notes.AsNoTracking().Where(n => n.UserId == userId).OrderBy(n => n.Title).ToListAsync(ct);
}).RequireAuthorization();

app.Run();
