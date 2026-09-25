using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using NotesApi.Data;

namespace NotesApi.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20240101000000_CreateNotes")]
public partial class CreateNotes : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "Notes",
            columns: table => new
            {
                Id = table.Column<Guid>(nullable: false),
                UserId = table.Column<Guid>(nullable: false),
                Title = table.Column<string>(maxLength: 200, nullable: false)
            },
            constraints: table => table.PrimaryKey("PK_Notes", x => x.Id));
        migrationBuilder.CreateIndex(name: "IX_Notes_UserId", table: "Notes", column: "UserId");
    }

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.DropTable(name: "Notes");
}
